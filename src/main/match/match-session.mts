import {
  applyDeviceCounterEvent,
  createRefereeScoringState,
  resetRefereeScoringState,
  type RefereeMode,
  type RefereeScoringState
} from '../domain/scoring.mts'
import type {
  MatchScoreEventWrite,
  MatchScoreEventWriteResult
} from '../persistence/local-database.mts'
import type {
  ContextTransitionInput,
  ContextTransitionResult,
  MediaBinding,
  ParsedMediaUrl
} from '../../shared/media/media-contract.mts'
import {
  MatchDeviceSession,
  type MatchDeviceBinding,
  type MatchDeviceConnection,
  type MatchDeviceConnectionRequest
} from './match-device-session.mts'
import { MatchMediaSession } from './media-session.mts'
import { MatchSessionError } from './match-session-error.mts'
import {
  MatchSessionNotifier,
  type MatchRefereeUpdate,
  type MatchSessionState,
  type MatchStatusUpdate
} from './match-session-notifier.mts'

export { MatchSessionError } from './match-session-error.mts'
export type {
  MatchRefereeUpdate,
  MatchSessionState,
  MatchStatusUpdate
} from './match-session-notifier.mts'

export interface MatchRefereeBinding extends MatchDeviceBinding {
  name: string
}

export interface MatchStartInput {
  sourceKey: string
  stageId: string
  groupName: string
  contestantName: string
  attemptNumber: number
  referees: MatchRefereeBinding[]
}

interface RefereeRuntime {
  index: number
  name: string
  mode: RefereeMode
  scoring: RefereeScoringState
  status: { pri: string; sec: string }
}

interface MatchSessionDependencies {
  requestWorker: (
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<unknown>
  persistEvent: (input: MatchScoreEventWrite) => MatchScoreEventWriteResult
  activateContext?: (context: MatchPersistenceContext, occurredAt: string) => void
  transitionContext?: (
    current: MatchPersistenceContext,
    next: MatchPersistenceContext,
    occurredAt: string
  ) => void
  completeContext?: (context: MatchPersistenceContext, occurredAt: string) => void
  invalidateContext?: (context: MatchPersistenceContext, occurredAt: string) => void
  validateContext?: (
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string,
    attemptNumber: number,
    refereeIndexes: number[]
  ) => boolean
  emitRefereeUpdate: (update: MatchRefereeUpdate) => void
  emitContextUpdate?: (context: { groupName: string; contestantName: string }) => void
  emitStatusUpdate?: (status: MatchStatusUpdate) => void
  replaceMediaBinding?: (
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string,
    binding: ParsedMediaUrl
  ) => MediaBinding | null
  getMediaBinding?: (
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string
  ) => MediaBinding | null
  removeMediaBinding?: (
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string
  ) => boolean
  onError?: (code: string, error?: unknown) => void
  now?: () => Date
  monotonicNow?: () => number
}

interface MatchPersistenceContext {
  sourceKey: string
  stageId: string
  groupName: string
  contestantName: string
  attemptNumber: number
}

export class MatchSessionService {
  private readonly dependencies: MatchSessionDependencies
  private readonly deviceSession: MatchDeviceSession
  private readonly mediaSession: MatchMediaSession
  private readonly notifier: MatchSessionNotifier
  private readonly referees = new Map<number, RefereeRuntime>()
  private state: MatchSessionState = 'idle'
  private persistence: MatchStatusUpdate['persistence'] = 'idle'
  private worker: MatchStatusUpdate['worker'] = 'idle'
  private media: MatchStatusUpdate['media'] = 'not_ready'
  private errorCode: string | null = null
  private lastSavedAt: string | null = null
  private sourceKey = ''
  private stageId = ''
  private groupName = ''
  private contestantName = ''
  private attemptNumber = 1
  private operationVersion = 0
  private controlOperationPending = false

  constructor(dependencies: MatchSessionDependencies) {
    this.dependencies = dependencies
    this.deviceSession = new MatchDeviceSession({ requestWorker: dependencies.requestWorker })
    this.mediaSession = new MatchMediaSession({
      replaceMediaBinding: dependencies.replaceMediaBinding,
      getMediaBinding: dependencies.getMediaBinding,
      removeMediaBinding: dependencies.removeMediaBinding,
      monotonicNow: dependencies.monotonicNow
    })
    this.notifier = new MatchSessionNotifier({
      emitRefereeUpdate: dependencies.emitRefereeUpdate,
      emitContextUpdate: dependencies.emitContextUpdate,
      emitStatusUpdate: dependencies.emitStatusUpdate,
      onError: dependencies.onError
    })
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
        normalized.stageId,
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
    this.mediaSession.reset()
    this.errorCode = null
    this.lastSavedAt = null
    this.publishStatus()

    try {
      await this.deviceSession.disconnectBeforeStart()
      this.assertCurrentOperation(operationVersion)
      this.configure(normalized)

      const requests = this.deviceSession.configure(normalized.referees)
      if (requests.length === 0) {
        this.activatePersistenceContext()
        this.worker = 'ready'
        this.state = 'active'
        this.publishStatus()
        return { connections: [], status: this.getStatus() }
      }

      const result = await this.connectConfigured(requests)
      this.assertCurrentOperation(operationVersion)
      this.activatePersistenceContext()
      this.state = 'active'
      this.updateWorkerStatusFromConnections()
      this.publishStatus()
      return { ...result, status: this.getStatus() }
    } catch (error) {
      if (operationVersion !== this.operationVersion) {
        await this.deviceSession.disconnectAfterCancelledStart()
        throw new MatchSessionError('MATCH_START_CANCELLED', 'Match start was cancelled')
      }
      this.state = 'failed'
      this.worker = 'error'
      this.errorCode = stableErrorCode(error, 'MATCH_START_FAILED')
      this.publishStatus()
      await this.deviceSession.disconnectAfterCancelledStart()
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
    this.deviceSession.clear()
    this.referees.clear()
    this.mediaSession.reset()
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
    const requests = this.deviceSession.connectionRequests()
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

  async transitionContext(input: ContextTransitionInput): Promise<ContextTransitionResult> {
    const { group_name: groupName, contestant_name: contestantName } = input
    validateContext(groupName, contestantName)
    if (
      (input.progress_mode !== 'continue' && input.progress_mode !== 'reset') ||
      (input.binding_version_id !== null && !boundedString(input.binding_version_id, 256)) ||
      (input.expected_media_key !== null && !boundedString(input.expected_media_key, 1024))
    ) {
      throw new MatchSessionError('MATCH_CONTEXT_INVALID', 'Media transition input is invalid')
    }
    this.requireActive()
    if (groupName === this.groupName && contestantName === this.contestantName) {
      throw new MatchSessionError('MATCH_CONTEXT_INVALID', 'Target context is already active')
    }
    if (
      this.dependencies.validateContext &&
      !this.dependencies.validateContext(
        this.sourceKey,
        this.stageId,
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
    let targetMedia: ReturnType<MatchMediaSession['prepareTransition']> | null = null
    let contextTransitioned = false
    try {
      targetMedia = this.mediaSession.prepareTransition(
        this.currentMediaContext(),
        {
          sourceKey: this.sourceKey,
          stageId: this.stageId,
          groupName,
          contestantName
        },
        input.binding_version_id,
        input.progress_mode,
        input.expected_media_key
      )
      this.media = 'not_ready'
      this.publishStatus()
      await this.deviceSession.resetAll()
      this.assertCurrentOperation(operationVersion)
      this.dependencies.transitionContext?.(
        this.currentPersistenceContext(),
        {
          sourceKey: this.sourceKey,
          stageId: this.stageId,
          groupName,
          contestantName,
          attemptNumber: this.attemptNumber
        },
        this.now().toISOString()
      )
      contextTransitioned = true
      this.groupName = groupName
      this.contestantName = contestantName
      for (const runtime of this.referees.values()) {
        runtime.scoring = resetRefereeScoringState(runtime.scoring)
        this.emitReferee(runtime)
      }
      const playback = targetMedia.binding
        ? this.mediaSession.beginPlayback(
            this.currentMediaContext(),
            targetMedia.binding.version_id
          )
        : null
      this.media = this.mediaSession.capture(this.currentMediaContext()).status
      this.mediaSession.commitTransition()
      this.emitContext({ groupName, contestantName })
      this.publishStatus()
      return {
        group_name: groupName,
        contestant_name: contestantName,
        binding: targetMedia.binding,
        playback_session_id: playback?.playback_session_id ?? null,
        progress_mode: input.progress_mode,
        continuity_position_ms: targetMedia.continuityPositionMs
      }
    } catch (error) {
      if (!contextTransitioned && targetMedia) {
        this.mediaSession.rollbackTransition()
        this.media = this.mediaSession.capture(this.currentMediaContext()).status
        this.publishStatus()
      }
      throw error
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
      const result = await this.deviceSession.resetAll()
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

  completeCurrent(): boolean {
    if (this.state !== 'active') return false
    this.dependencies.completeContext?.(this.currentPersistenceContext(), this.now().toISOString())
    return true
  }

  invalidateCurrent(): boolean {
    if (this.state !== 'active') return false
    this.dependencies.invalidateContext?.(
      this.currentPersistenceContext(),
      this.now().toISOString()
    )
    return true
  }

  beginPlayback(bindingVersionId: string): ReturnType<MatchMediaSession['beginPlayback']> {
    this.requireActive()
    if (!boundedString(bindingVersionId, 256)) {
      throw new MatchSessionError('MEDIA_BINDING_VERSION_CONFLICT', 'Binding version is invalid')
    }
    const playback = this.mediaSession.beginPlayback(this.currentMediaContext(), bindingVersionId)
    this.media = this.mediaSession.capture(this.currentMediaContext()).status
    this.publishStatus()
    return playback
  }

  updatePlayback(value: Record<string, unknown>): MatchStatusUpdate['media'] {
    this.requireActive()
    this.media = this.mediaSession.updatePlayback(value, this.currentMediaContext())
    this.publishStatus()
    return this.media
  }

  reportMediaError(value: Record<string, unknown>): MatchStatusUpdate['media'] {
    this.requireActive()
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new MatchSessionError('MEDIA_PLAYBACK_INVALID', 'Playback error is invalid')
    }
    this.media = this.mediaSession.reportPlaybackError(value, this.currentMediaContext())
    this.publishStatus()
    return this.media
  }

  getMediaBinding(groupName: string, contestantName: string): MediaBinding | null {
    this.requireActive()
    return this.mediaSession.getBinding(this.currentMediaContext(), groupName, contestantName)
  }

  replaceMediaBinding(
    groupName: string,
    contestantName: string,
    parsed: ParsedMediaUrl
  ): MediaBinding {
    this.requireActive()
    return this.mediaSession.replaceBinding(
      this.currentMediaContext(),
      groupName,
      contestantName,
      parsed
    )
  }

  removeMediaBinding(groupName: string, contestantName: string): void {
    this.requireActive()
    this.mediaSession.removeBinding(this.currentMediaContext(), groupName, contestantName)
    if (groupName === this.groupName && contestantName === this.contestantName) {
      this.media = 'not_ready'
      this.publishStatus()
    }
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
    const connection = this.deviceSession.connectionFor(connectionId)
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
    connection: MatchDeviceConnection,
    message: Record<string, unknown> & { payload: Record<string, unknown> }
  ): void {
    const timestamp = this.now().toISOString()
    const media = this.mediaSession.capture(this.currentMediaContext())
    this.persistence = 'saving'
    this.media = media.status
    this.errorCode = null
    this.publishStatus()

    let result: MatchScoreEventWriteResult
    try {
      result = this.dependencies.persistEvent({
        sourceKey: this.sourceKey,
        stageId: this.stageId,
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
          mediaBindingVersionId: media.bindingVersionId,
          mediaProvider: media.provider,
          mediaId: media.mediaId,
          mediaSegment: media.segment,
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
    this.sourceKey = input.sourceKey
    this.stageId = input.stageId
    this.groupName = input.groupName
    this.contestantName = input.contestantName
    this.attemptNumber = input.attemptNumber
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

  private activatePersistenceContext(): void {
    this.dependencies.activateContext?.(this.currentPersistenceContext(), this.now().toISOString())
  }

  private currentPersistenceContext(): MatchPersistenceContext {
    return {
      sourceKey: this.sourceKey,
      stageId: this.stageId,
      groupName: this.groupName,
      contestantName: this.contestantName,
      attemptNumber: this.attemptNumber
    }
  }

  private currentMediaContext(): MatchPersistenceContext {
    return this.currentPersistenceContext()
  }

  private async connectConfigured(
    requests: MatchDeviceConnectionRequest[]
  ): Promise<{ connections: unknown[] }> {
    const result = await this.deviceSession.connectConfigured(requests)
    for (const value of result.connections) this.applyConnectionResult(value)
    return result
  }

  private updateWorkerStatusFromConnections(): void {
    const hasError = [...this.referees.values()].some(
      (runtime) => runtime.status.pri === 'error' || runtime.status.sec === 'error'
    )
    this.worker = hasError ? 'error' : 'ready'
    this.errorCode = hasError ? 'MATCH_DEVICE_CONNECTION_FAILED' : null
  }

  private applyConnectionResult(value: unknown): void {
    if (!isRecord(value)) return
    const connection = this.deviceSession.connectionFor(stringValue(value.connectionId))
    if (!connection) return
    const runtime = this.referees.get(connection.refereeIndex)
    if (!runtime) return
    const status = value.status === 'connected' ? 'connected' : 'error'
    runtime.status[connection.role === 'primary' ? 'pri' : 'sec'] = status
    this.emitReferee(runtime)
  }

  private emitReferee(runtime: RefereeRuntime): void {
    this.notifier.referee({
      index: runtime.index,
      name: runtime.name,
      mode: runtime.mode,
      score: { ...runtime.scoring.score },
      status: { ...runtime.status }
    })
  }

  private emitContext(context: { groupName: string; contestantName: string }): void {
    this.notifier.context(context)
  }

  private publishStatus(): void {
    this.notifier.status(this.getStatus())
  }

  private reportError(code: string, error?: unknown): void {
    this.errorCode = code
    this.notifier.error(code, error)
    this.publishStatus()
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

  private now(): Date {
    return (this.dependencies.now ?? (() => new Date()))()
  }
}

function validateStartInput(input: MatchStartInput): MatchStartInput {
  if (!input || typeof input !== 'object') {
    throw new MatchSessionError('MATCH_CONFIG_INVALID', 'Match config is required')
  }
  for (const value of [input.sourceKey, input.stageId, input.groupName, input.contestantName]) {
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

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}
