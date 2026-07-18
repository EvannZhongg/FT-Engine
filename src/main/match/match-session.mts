import {
  applyDeviceCounterEvent,
  createRefereeScoringState,
  resetRefereeScoringState,
  type DeviceRole,
  type RefereeMode,
  type RefereeScoringState
} from '../domain/scoring.mts'
import type {
  MatchScoreEventWrite,
  MatchScoreEventWriteResult
} from '../persistence/local-database.mts'
import { normalizeYouTubeUrl, type YouTubeMediaBinding } from '../../shared/media/youtube.mts'

export interface MatchRefereeBinding {
  index: number
  name: string
  mode: RefereeMode
  primaryDeviceId: string | null
  secondaryDeviceId: string | null
}

export interface MatchStartInput {
  sourceKey: string
  groupName: string
  contestantName: string
  attemptNumber: number
  referees: MatchRefereeBinding[]
}

export interface MatchRefereeUpdate {
  index: number
  name: string
  mode: RefereeMode
  score: { total: number; plus: number; minus: number; penalty: number }
  status: { pri: string; sec: string }
}

export type MatchSessionState = 'idle' | 'starting' | 'active' | 'stopping' | 'completed' | 'failed'

export interface MatchStatusUpdate {
  state: MatchSessionState
  persistence: 'idle' | 'saving' | 'saved' | 'error'
  worker: 'idle' | 'ready' | 'reconnecting' | 'error'
  media: 'not_ready' | 'aligned' | 'stale' | 'context_mismatch'
  errorCode: string | null
  lastSavedAt: string | null
}

interface RefereeRuntime {
  index: number
  name: string
  mode: RefereeMode
  scoring: RefereeScoringState
  status: { pri: string; sec: string }
}

interface ConnectionRuntime {
  refereeIndex: number
  role: DeviceRole
  deviceId: string
}

interface MatchSessionDependencies {
  requestWorker: (
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<unknown>
  persistEvent: (input: MatchScoreEventWrite) => MatchScoreEventWriteResult
  validateContext?: (
    sourceKey: string,
    groupName: string,
    contestantName: string,
    attemptNumber: number,
    refereeIndexes: number[]
  ) => boolean
  emitRefereeUpdate: (update: MatchRefereeUpdate) => void
  emitContextUpdate?: (context: { groupName: string; contestantName: string }) => void
  emitStatusUpdate?: (status: MatchStatusUpdate) => void
  upsertMediaBinding?: (
    sourceKey: string,
    groupName: string,
    contestantName: string,
    binding: { provider: string; mediaId: string; canonicalUrl: string }
  ) => boolean
  onError?: (code: string, error?: unknown) => void
  now?: () => Date
  monotonicNow?: () => number
}

interface PlaybackAnchor {
  groupName: string
  contestantName: string
  videoId: string
  videoTimeMs: number
  state: 'playing' | 'paused' | 'buffering' | 'cued' | 'ended'
  playbackRate: number
  receivedAtMs: number
}

interface MediaCapture {
  provider: string
  mediaId: string
  mediaTimeMs: number | null
  status: MatchStatusUpdate['media']
}

export class MatchSessionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export class MatchSessionService {
  private readonly dependencies: MatchSessionDependencies
  private readonly referees = new Map<number, RefereeRuntime>()
  private readonly connections = new Map<string, ConnectionRuntime>()
  private state: MatchSessionState = 'idle'
  private persistence: MatchStatusUpdate['persistence'] = 'idle'
  private worker: MatchStatusUpdate['worker'] = 'idle'
  private media: MatchStatusUpdate['media'] = 'not_ready'
  private errorCode: string | null = null
  private lastSavedAt: string | null = null
  private sourceKey = ''
  private groupName = ''
  private contestantName = ''
  private attemptNumber = 1
  private playbackAnchor: PlaybackAnchor | null = null
  private operationVersion = 0
  private controlOperationPending = false

  constructor(dependencies: MatchSessionDependencies) {
    this.dependencies = dependencies
  }

  getStatus(): MatchStatusUpdate {
    return {
      state: this.state,
      persistence: this.persistence,
      worker: this.worker,
      media: this.media,
      errorCode: this.errorCode,
      lastSavedAt: this.lastSavedAt
    }
  }

  async start(
    input: MatchStartInput
  ): Promise<{ connections: unknown[]; status: MatchStatusUpdate }> {
    const normalized = validateStartInput(input)
    if (this.state === 'starting' || this.state === 'active' || this.state === 'stopping') {
      throw new MatchSessionError('MATCH_STATE_CONFLICT', `Cannot start while ${this.state}`)
    }
    if (
      this.dependencies.validateContext &&
      !this.dependencies.validateContext(
        normalized.sourceKey,
        normalized.groupName,
        normalized.contestantName,
        normalized.attemptNumber,
        normalized.referees.map((referee) => referee.index)
      )
    ) {
      throw new MatchSessionError('MATCH_CONTEXT_INVALID', 'Match context is not configured')
    }

    const operationVersion = ++this.operationVersion
    this.state = 'starting'
    this.persistence = 'idle'
    this.worker = 'reconnecting'
    this.media = 'not_ready'
    this.errorCode = null
    this.lastSavedAt = null
    this.publishStatus()

    try {
      await this.dependencies.requestWorker('device.disconnectAll')
      this.assertCurrentOperation(operationVersion)
      this.configure(normalized)

      const requests = this.buildConnectionRequests(normalized.referees)
      if (requests.length === 0) {
        this.worker = 'ready'
        this.state = 'active'
        this.publishStatus()
        return { connections: [], status: this.getStatus() }
      }

      const result = await this.connectConfigured(requests)
      this.assertCurrentOperation(operationVersion)
      this.state = 'active'
      this.updateWorkerStatusFromConnections()
      this.publishStatus()
      return { ...result, status: this.getStatus() }
    } catch (error) {
      if (operationVersion !== this.operationVersion) {
        await this.disconnectAfterCancelledStart()
        throw new MatchSessionError('MATCH_START_CANCELLED', 'Match start was cancelled')
      }
      this.state = 'failed'
      this.worker = 'error'
      this.errorCode = stableErrorCode(error, 'MATCH_START_FAILED')
      this.publishStatus()
      await this.disconnectAfterCancelledStart()
      throw error
    }
  }

  isActive(): boolean {
    return this.state === 'active'
  }

  beginStopping(): boolean {
    if (this.state === 'idle' || this.state === 'completed') return false
    if (this.state === 'stopping') return true
    this.operationVersion += 1
    this.state = 'stopping'
    this.publishStatus()
    return true
  }

  completeStop(ok: boolean): void {
    if (this.state !== 'stopping') return
    this.connections.clear()
    this.referees.clear()
    this.playbackAnchor = null
    this.controlOperationPending = false
    this.worker = 'idle'
    this.media = 'not_ready'
    if (ok) {
      this.state = 'completed'
      this.persistence = 'idle'
      this.errorCode = null
    } else {
      this.state = 'failed'
      this.errorCode = 'MATCH_STOP_FAILED'
    }
    this.publishStatus()
  }

  markWorkerUnavailable(): void {
    if (this.state !== 'starting' && this.state !== 'active') return
    this.worker = 'error'
    this.errorCode = 'MATCH_WORKER_UNAVAILABLE'
    for (const runtime of this.referees.values()) {
      if (runtime.status.pri !== 'n/a') runtime.status.pri = 'error'
      if (runtime.status.sec !== 'n/a') runtime.status.sec = 'error'
      this.emitReferee(runtime)
    }
    this.publishStatus()
  }

  async reconnectWorker(): Promise<{ connections: unknown[] }> {
    if (this.state !== 'active') return { connections: [] }
    const operationVersion = this.operationVersion
    const requests = [...this.connections].map(([connectionId, value]) => ({
      connectionId,
      deviceId: value.deviceId
    }))
    this.worker = 'reconnecting'
    this.errorCode = null
    for (const runtime of this.referees.values()) {
      if (runtime.status.pri !== 'n/a') runtime.status.pri = 'connecting'
      if (runtime.status.sec !== 'n/a') runtime.status.sec = 'connecting'
      this.emitReferee(runtime)
    }
    this.publishStatus()

    try {
      const result = await this.connectConfigured(requests)
      this.assertCurrentOperation(operationVersion)
      this.updateWorkerStatusFromConnections()
      this.publishStatus()
      return result
    } catch (error) {
      if (operationVersion === this.operationVersion && this.state === 'active') {
        this.worker = 'error'
        this.errorCode = 'MATCH_WORKER_RECONNECT_FAILED'
        this.reportError(this.errorCode, error)
      }
      throw error
    }
  }

  async setContext(groupName: string, contestantName: string): Promise<void> {
    validateContext(groupName, contestantName)
    this.requireActive()
    if (groupName === this.groupName && contestantName === this.contestantName) return
    if (
      this.dependencies.validateContext &&
      !this.dependencies.validateContext(
        this.sourceKey,
        groupName,
        contestantName,
        this.attemptNumber,
        [...this.referees.keys()]
      )
    ) {
      throw new MatchSessionError('MATCH_CONTEXT_INVALID', 'Match context is not configured')
    }
    if (this.controlOperationPending) {
      throw new MatchSessionError('MATCH_OPERATION_IN_PROGRESS', 'A match control is in progress')
    }

    const operationVersion = this.operationVersion
    this.controlOperationPending = true
    try {
      await this.dependencies.requestWorker('device.resetAll', {}, 10000)
      this.assertCurrentOperation(operationVersion)
      this.groupName = groupName
      this.contestantName = contestantName
      for (const runtime of this.referees.values()) {
        runtime.scoring = resetRefereeScoringState(runtime.scoring)
        this.emitReferee(runtime)
      }
      this.media = this.captureMedia().status
      this.emitContext({ groupName, contestantName })
      this.publishStatus()
    } finally {
      this.controlOperationPending = false
    }
  }

  async reset(): Promise<unknown> {
    this.requireActive()
    if (this.controlOperationPending) {
      throw new MatchSessionError('MATCH_OPERATION_IN_PROGRESS', 'A match control is in progress')
    }
    const operationVersion = this.operationVersion
    this.controlOperationPending = true
    try {
      const result = await this.dependencies.requestWorker('device.resetAll', {}, 10000)
      this.assertCurrentOperation(operationVersion)
      for (const runtime of this.referees.values()) {
        runtime.scoring = resetRefereeScoringState(runtime.scoring)
        this.emitReferee(runtime)
      }
      return result
    } finally {
      this.controlOperationPending = false
    }
  }

  updatePlayback(value: Record<string, unknown>): void {
    this.requireActive()
    const groupName = stringValue(value.group)
    const contestantName = stringValue(value.contestant)
    const videoId = stringValue(value.video_id)
    const state = stringValue(value.state)
    const videoTimeMs = Number(value.video_time_ms)
    const playbackRate = Number(value.playback_rate ?? 1)
    if (
      !groupName ||
      !contestantName ||
      !/^[A-Za-z0-9_-]{11}$/.test(videoId) ||
      !['playing', 'paused', 'buffering', 'cued', 'ended'].includes(state) ||
      !Number.isFinite(videoTimeMs) ||
      videoTimeMs < 0 ||
      !Number.isFinite(playbackRate) ||
      playbackRate <= 0 ||
      playbackRate > 4
    ) {
      throw new MatchSessionError('MATCH_PLAYBACK_INVALID', 'Playback anchor is invalid')
    }
    this.playbackAnchor = {
      groupName,
      contestantName,
      videoId,
      videoTimeMs: Math.round(videoTimeMs),
      state: state as PlaybackAnchor['state'],
      playbackRate,
      receivedAtMs: this.monotonicNow()
    }
    this.media = this.captureMedia().status
    this.publishStatus()
  }

  setMediaBinding(groupName: string, contestantName: string, url: string): YouTubeMediaBinding {
    this.requireActive()
    if (!groupName || !contestantName) {
      throw new MatchSessionError('MATCH_MEDIA_INVALID', 'Media binding is invalid')
    }
    let binding: YouTubeMediaBinding
    try {
      binding = normalizeYouTubeUrl(url)
    } catch (error) {
      throw new MatchSessionError(
        stableErrorCode(error, 'MATCH_MEDIA_INVALID'),
        'Media binding is invalid'
      )
    }
    const saved =
      this.dependencies.upsertMediaBinding?.(this.sourceKey, groupName, contestantName, {
        provider: binding.provider,
        mediaId: binding.video_id,
        canonicalUrl: binding.canonical_url
      }) ?? false
    if (!saved) {
      throw new MatchSessionError('MATCH_MEDIA_CONTEXT_NOT_FOUND', 'Media context was not found')
    }
    return binding
  }

  handleWorkerEvent(message: unknown): void {
    if (this.state !== 'starting' && this.state !== 'active') return
    try {
      this.handleWorkerEventUnsafe(message)
    } catch (error) {
      this.reportError(stableErrorCode(error, 'MATCH_EVENT_INVALID'), error)
    }
  }

  private handleWorkerEventUnsafe(message: unknown): void {
    if (!isRecord(message)) return
    if (message.event !== 'device.status' && message.event !== 'device.counter') return
    if (!isRecord(message.payload)) {
      throw new MatchSessionError('MATCH_EVENT_INVALID', 'Worker event payload is invalid')
    }
    const payload = message.payload
    const connectionId = stringValue(payload.connectionId)
    const connection = this.connections.get(connectionId)
    if (!connection) return
    const runtime = this.referees.get(connection.refereeIndex)
    if (!runtime) return

    if (message.event === 'device.status') {
      const status = stringValue(payload.status)
      if (!status || status.length > 64) {
        throw new MatchSessionError('MATCH_EVENT_INVALID', 'Device status is invalid')
      }
      runtime.status[connection.role === 'primary' ? 'pri' : 'sec'] = status
      this.emitReferee(runtime)
      return
    }
    if (message.event !== 'device.counter') return
    if (typeof message.eventId !== 'string') {
      throw new MatchSessionError('MATCH_EVENT_INVALID', 'Counter event id is invalid')
    }

    const next = applyDeviceCounterEvent(runtime.scoring, {
      eventId: message.eventId,
      role: connection.role,
      eventType: integerValue(payload.eventType),
      totalPlus: integerValue(payload.totalPlus),
      totalMinus: integerValue(payload.totalMinus),
      deviceTimestampMs: integerValue(payload.deviceTimestampMs)
    })
    if (next === runtime.scoring) return
    this.persistCounterEvent(runtime, next, connectionId, connection, { ...message, payload })
  }

  private persistCounterEvent(
    runtime: RefereeRuntime,
    next: RefereeScoringState,
    connectionId: string,
    connection: ConnectionRuntime,
    message: Record<string, unknown> & { payload: Record<string, unknown> }
  ): void {
    const timestamp = this.now().toISOString()
    const media = this.captureMedia()
    this.persistence = 'saving'
    this.media = media.status
    this.errorCode = null
    this.publishStatus()

    let result: MatchScoreEventWriteResult
    try {
      result = this.dependencies.persistEvent({
        sourceKey: this.sourceKey,
        groupName: this.groupName,
        contestantName: this.contestantName,
        attemptNumber: this.attemptNumber,
        refereeIndex: runtime.index,
        event: {
          eventId: String(message.eventId),
          connectionId,
          deviceId: connection.deviceId,
          role: connection.role,
          eventType: integerValue(message.payload.eventType),
          deviceTimestampMs: integerValue(message.payload.deviceTimestampMs),
          receivedAt: timestamp,
          systemTime: timestamp,
          totalPlus: next.score.plus,
          totalMinus: next.score.minus,
          currentTotal: next.score.total,
          majorPenalty: next.score.penalty,
          mediaProvider: media.provider,
          mediaId: media.mediaId,
          mediaTimeMs: media.mediaTimeMs,
          mediaSyncStatus: media.status
        }
      })
    } catch (error) {
      this.persistence = 'error'
      this.reportError('MATCH_EVENT_PERSIST_FAILED', error)
      return
    }

    if (result.status === 'context_missing') {
      this.persistence = 'error'
      this.reportError('MATCH_EVENT_CONTEXT_NOT_FOUND')
      return
    }

    this.persistence = 'saved'
    if (result.status === 'inserted') {
      runtime.scoring = next
      this.lastSavedAt = timestamp
      this.emitReferee(runtime)
    }
    this.publishStatus()
  }

  private configure(input: MatchStartInput): void {
    this.referees.clear()
    this.connections.clear()
    this.sourceKey = input.sourceKey
    this.groupName = input.groupName
    this.contestantName = input.contestantName
    this.attemptNumber = input.attemptNumber
    this.playbackAnchor = null
    for (const binding of input.referees) {
      const runtime: RefereeRuntime = {
        index: binding.index,
        name: binding.name,
        mode: binding.mode,
        scoring: createRefereeScoringState(binding.mode),
        status: {
          pri: binding.primaryDeviceId ? 'connecting' : 'n/a',
          sec: binding.mode === 'DUAL' && binding.secondaryDeviceId ? 'connecting' : 'n/a'
        }
      }
      this.referees.set(binding.index, runtime)
      this.emitReferee(runtime)
    }
  }

  private buildConnectionRequests(
    bindings: MatchRefereeBinding[]
  ): Array<{ connectionId: string; deviceId: string }> {
    const requests: Array<{ connectionId: string; deviceId: string }> = []
    for (const binding of bindings) {
      this.addConnection(requests, binding.index, 'primary', binding.primaryDeviceId)
      if (binding.mode === 'DUAL') {
        this.addConnection(requests, binding.index, 'secondary', binding.secondaryDeviceId)
      }
    }
    return requests
  }

  private async connectConfigured(
    requests: Array<{ connectionId: string; deviceId: string }>
  ): Promise<{ connections: unknown[] }> {
    const result = (await this.dependencies.requestWorker(
      'device.connectMany',
      { connections: requests },
      30000
    )) as { connections?: unknown[] }
    for (const value of result.connections ?? []) this.applyConnectionResult(value)
    return { connections: result.connections ?? [] }
  }

  private updateWorkerStatusFromConnections(): void {
    const hasError = [...this.referees.values()].some(
      (runtime) => runtime.status.pri === 'error' || runtime.status.sec === 'error'
    )
    this.worker = hasError ? 'error' : 'ready'
    this.errorCode = hasError ? 'MATCH_DEVICE_CONNECTION_FAILED' : null
  }

  private addConnection(
    requests: Array<{ connectionId: string; deviceId: string }>,
    refereeIndex: number,
    role: DeviceRole,
    deviceId: string | null
  ): void {
    if (!deviceId) return
    const connectionId = `match-ref-${refereeIndex}-${role}`
    this.connections.set(connectionId, { refereeIndex, role, deviceId })
    requests.push({ connectionId, deviceId })
  }

  private applyConnectionResult(value: unknown): void {
    if (!isRecord(value)) return
    const connection = this.connections.get(stringValue(value.connectionId))
    if (!connection) return
    const runtime = this.referees.get(connection.refereeIndex)
    if (!runtime) return
    const status = value.status === 'connected' ? 'connected' : 'error'
    runtime.status[connection.role === 'primary' ? 'pri' : 'sec'] = status
    this.emitReferee(runtime)
  }

  private emitReferee(runtime: RefereeRuntime): void {
    try {
      this.dependencies.emitRefereeUpdate({
        index: runtime.index,
        name: runtime.name,
        mode: runtime.mode,
        score: { ...runtime.scoring.score },
        status: { ...runtime.status }
      })
    } catch (error) {
      this.notifyError('MATCH_RENDERER_NOTIFY_FAILED', error)
    }
  }

  private emitContext(context: { groupName: string; contestantName: string }): void {
    try {
      this.dependencies.emitContextUpdate?.(context)
    } catch (error) {
      this.notifyError('MATCH_RENDERER_NOTIFY_FAILED', error)
    }
  }

  private publishStatus(): void {
    try {
      this.dependencies.emitStatusUpdate?.(this.getStatus())
    } catch (error) {
      this.notifyError('MATCH_RENDERER_NOTIFY_FAILED', error)
    }
  }

  private reportError(code: string, error?: unknown): void {
    this.errorCode = code
    this.notifyError(code, error)
    this.publishStatus()
  }

  private notifyError(code: string, error?: unknown): void {
    try {
      this.dependencies.onError?.(code, error)
    } catch {
      // Error reporting must never escape a Worker EventEmitter callback.
    }
  }

  private captureMedia(): MediaCapture {
    const anchor = this.playbackAnchor
    if (!anchor) return { provider: '', mediaId: '', mediaTimeMs: null, status: 'not_ready' }
    if (anchor.groupName !== this.groupName || anchor.contestantName !== this.contestantName) {
      return {
        provider: 'youtube',
        mediaId: anchor.videoId,
        mediaTimeMs: null,
        status: 'context_mismatch'
      }
    }
    const ageMs = Math.max(0, this.monotonicNow() - anchor.receivedAtMs)
    if (ageMs > 500) {
      return { provider: 'youtube', mediaId: anchor.videoId, mediaTimeMs: null, status: 'stale' }
    }
    const advanced = anchor.state === 'playing' ? ageMs * anchor.playbackRate : 0
    return {
      provider: 'youtube',
      mediaId: anchor.videoId,
      mediaTimeMs: Math.max(0, Math.round(anchor.videoTimeMs + advanced)),
      status: 'aligned'
    }
  }

  private requireActive(): void {
    if (this.state !== 'active') {
      throw new MatchSessionError('MATCH_NOT_ACTIVE', 'Match is not active')
    }
  }

  private assertCurrentOperation(operationVersion: number): void {
    if (operationVersion !== this.operationVersion) {
      throw new MatchSessionError('MATCH_OPERATION_CANCELLED', 'Match operation was cancelled')
    }
  }

  private async disconnectAfterCancelledStart(): Promise<void> {
    try {
      await this.dependencies.requestWorker('device.disconnectAll', {}, 5000)
    } catch {
      // The original start error remains authoritative.
    }
  }

  private now(): Date {
    return (this.dependencies.now ?? (() => new Date()))()
  }

  private monotonicNow(): number {
    return (this.dependencies.monotonicNow ?? (() => performance.now()))()
  }
}

function validateStartInput(input: MatchStartInput): MatchStartInput {
  if (!input || typeof input !== 'object') {
    throw new MatchSessionError('MATCH_CONFIG_INVALID', 'Match config is required')
  }
  for (const value of [input.sourceKey, input.groupName, input.contestantName]) {
    if (typeof value !== 'string' || !value || value.length > 256) {
      throw new MatchSessionError('MATCH_CONFIG_INVALID', 'Match context is invalid')
    }
  }
  if (!Array.isArray(input.referees) || input.referees.length > 32) {
    throw new MatchSessionError('MATCH_CONFIG_INVALID', 'Referees must be a bounded list')
  }
  if (
    !Number.isSafeInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    input.attemptNumber > 20
  ) {
    throw new MatchSessionError('MATCH_CONFIG_INVALID', 'Attempt number is invalid')
  }
  const indexes = new Set<number>()
  const deviceIds = new Set<string>()
  const referees = input.referees.map((value) => {
    if (
      !value ||
      !Number.isSafeInteger(value.index) ||
      value.index < 1 ||
      value.index > 1000 ||
      typeof value.name !== 'string' ||
      value.name.length > 128 ||
      (value.mode !== 'SINGLE' && value.mode !== 'DUAL')
    ) {
      throw new MatchSessionError('MATCH_CONFIG_INVALID', 'Referee config is invalid')
    }
    if (indexes.has(value.index)) {
      throw new MatchSessionError('MATCH_CONFIG_INVALID', 'Referee indexes must be unique')
    }
    indexes.add(value.index)
    const primaryDeviceId = optionalId(value.primaryDeviceId)
    const secondaryDeviceId = value.mode === 'DUAL' ? optionalId(value.secondaryDeviceId) : null
    for (const deviceId of [primaryDeviceId, secondaryDeviceId]) {
      if (!deviceId) continue
      if (deviceIds.has(deviceId)) {
        throw new MatchSessionError('MATCH_CONFIG_INVALID', 'Device bindings must be unique')
      }
      deviceIds.add(deviceId)
    }
    return {
      ...value,
      name: value.name || `Referee ${value.index}`,
      primaryDeviceId,
      secondaryDeviceId
    }
  })
  return { ...input, referees }
}

function validateContext(groupName: string, contestantName: string): void {
  if (typeof groupName !== 'string' || !groupName || groupName.length > 256) {
    throw new MatchSessionError('MATCH_CONTEXT_INVALID', 'groupName is required')
  }
  if (typeof contestantName !== 'string' || !contestantName || contestantName.length > 256) {
    throw new MatchSessionError('MATCH_CONTEXT_INVALID', 'contestantName is required')
  }
}

function optionalId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > 128) {
    throw new MatchSessionError('MATCH_CONFIG_INVALID', 'Device id is invalid')
  }
  return value
}

function stableErrorCode(error: unknown, fallback: string): string {
  return isRecord(error) && typeof error.code === 'string' && error.code ? error.code : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function integerValue(value: unknown): number {
  return Number.isSafeInteger(value) ? Number(value) : Number.NaN
}
