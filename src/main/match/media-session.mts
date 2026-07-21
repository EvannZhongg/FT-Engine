import { randomUUID } from 'node:crypto'
import type {
  MediaBinding,
  MediaPlaybackSnapshot,
  MediaPlaybackState,
  MediaProgressMode,
  ParsedMediaUrl
} from '../../shared/media/media-contract.mts'
import { mediaKey } from '../../shared/media/media-contract.mts'
import { MatchSessionError } from './match-session-error.mts'

export type MatchMediaStatus =
  | 'not_ready'
  | 'aligned'
  | 'stale'
  | 'context_mismatch'
  | 'unsupported'
  | 'error'

export interface MatchMediaContext {
  sourceKey: string
  stageId: string
  groupName: string
  contestantName: string
}

export interface MatchMediaCapture {
  bindingVersionId: string | null
  provider: string
  mediaId: string
  segment: string
  mediaTimeMs: number | null
  status: MatchMediaStatus
}

export interface PlaybackSession {
  playback_session_id: string
  binding_version_id: string
  binding: MediaBinding
}

interface ActivePlayback extends PlaybackSession {
  groupName: string
  contestantName: string
}

interface PlaybackAnchor {
  playback_session_id: string
  binding_version_id: string
  groupName: string
  contestantName: string
  provider: MediaBinding['provider']
  media_id: string
  segment: string
  position_ms: number
  duration_ms: number | null
  state: MediaPlaybackState
  playback_rate: number
  sequence: number
  received_at_monotonic_ms: number
}

interface MatchMediaSessionDependencies {
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
  monotonicNow?: () => number
  createPlaybackSessionId?: () => string
}

export class MatchMediaSession {
  private readonly dependencies: MatchMediaSessionDependencies
  private activePlayback: ActivePlayback | null = null
  private playbackAnchor: PlaybackAnchor | null = null
  private playbackError = false
  private transitionCheckpoint: {
    activePlayback: ActivePlayback | null
    playbackAnchor: PlaybackAnchor | null
    playbackError: boolean
  } | null = null

  constructor(dependencies: MatchMediaSessionDependencies = {}) {
    this.dependencies = dependencies
  }

  reset(): void {
    this.activePlayback = null
    this.playbackAnchor = null
    this.playbackError = false
    this.transitionCheckpoint = null
  }

  invalidatePlayback(): void {
    this.activePlayback = null
    this.playbackAnchor = null
    this.playbackError = false
  }

  getBinding(
    context: MatchMediaContext,
    groupName: string,
    contestantName: string
  ): MediaBinding | null {
    validateContestant(groupName, contestantName)
    return (
      this.dependencies.getMediaBinding?.(
        context.sourceKey,
        context.stageId,
        groupName,
        contestantName
      ) ?? null
    )
  }

  replaceBinding(
    context: MatchMediaContext,
    groupName: string,
    contestantName: string,
    parsed: ParsedMediaUrl
  ): MediaBinding {
    validateContestant(groupName, contestantName)
    const saved =
      this.dependencies.replaceMediaBinding?.(
        context.sourceKey,
        context.stageId,
        groupName,
        contestantName,
        parsed
      ) ?? null
    if (!saved) {
      throw new MatchSessionError(
        'MEDIA_BINDING_CONTEXT_NOT_FOUND',
        'Media binding context was not found'
      )
    }
    if (
      this.activePlayback?.groupName === groupName &&
      this.activePlayback.contestantName === contestantName &&
      this.activePlayback.binding_version_id !== saved.version_id
    ) {
      this.invalidatePlayback()
    }
    return saved
  }

  removeBinding(context: MatchMediaContext, groupName: string, contestantName: string): void {
    validateContestant(groupName, contestantName)
    const removed =
      this.dependencies.removeMediaBinding?.(
        context.sourceKey,
        context.stageId,
        groupName,
        contestantName
      ) ?? false
    if (!removed) {
      throw new MatchSessionError(
        'MEDIA_BINDING_CONTEXT_NOT_FOUND',
        'Media binding context was not found'
      )
    }
    if (
      this.activePlayback?.groupName === groupName &&
      this.activePlayback.contestantName === contestantName
    ) {
      this.invalidatePlayback()
    }
  }

  beginPlayback(context: MatchMediaContext, bindingVersionId: string): PlaybackSession {
    const binding = this.getBinding(context, context.groupName, context.contestantName)
    if (!binding || binding.version_id !== bindingVersionId) {
      throw new MatchSessionError(
        'MEDIA_BINDING_VERSION_CONFLICT',
        'The requested media binding is no longer current'
      )
    }
    const playback: ActivePlayback = {
      playback_session_id: (this.dependencies.createPlaybackSessionId ?? randomUUID)(),
      binding_version_id: binding.version_id,
      binding,
      groupName: context.groupName,
      contestantName: context.contestantName
    }
    this.activePlayback = playback
    this.playbackAnchor = null
    this.playbackError = false
    return {
      playback_session_id: playback.playback_session_id,
      binding_version_id: playback.binding_version_id,
      binding: playback.binding
    }
  }

  prepareTransition(
    current: MatchMediaContext,
    target: MatchMediaContext,
    bindingVersionId: string | null,
    progressMode: MediaProgressMode,
    expectedMediaKey: string | null
  ): { binding: MediaBinding | null; continuityPositionMs: number | null } {
    const targetBinding = this.getBinding(target, target.groupName, target.contestantName)
    if ((targetBinding?.version_id ?? null) !== bindingVersionId) {
      throw new MatchSessionError(
        'MEDIA_BINDING_VERSION_CONFLICT',
        'The target media binding is no longer current'
      )
    }
    if ((targetBinding ? mediaKey(targetBinding) : null) !== expectedMediaKey) {
      throw new MatchSessionError(
        'MEDIA_BINDING_VERSION_CONFLICT',
        'The target media key changed during confirmation'
      )
    }

    let continuityPositionMs: number | null = null
    if (progressMode === 'continue') {
      const capture = this.capture(current)
      if (
        !targetBinding ||
        targetBinding.provider !== 'youtube' ||
        !this.activePlayback ||
        mediaKey(targetBinding) !== mediaKey(this.activePlayback.binding) ||
        capture.status !== 'aligned' ||
        capture.mediaTimeMs === null
      ) {
        throw new MatchSessionError(
          'MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE',
          'Playback position cannot be preserved'
        )
      }
      continuityPositionMs = capture.mediaTimeMs
    }
    this.transitionCheckpoint = {
      activePlayback: this.activePlayback,
      playbackAnchor: this.playbackAnchor,
      playbackError: this.playbackError
    }
    this.invalidatePlayback()
    return { binding: targetBinding, continuityPositionMs }
  }

  commitTransition(): void {
    this.transitionCheckpoint = null
  }

  rollbackTransition(): void {
    const checkpoint = this.transitionCheckpoint
    if (!checkpoint) return
    this.transitionCheckpoint = null
    this.activePlayback = checkpoint.activePlayback
    this.playbackAnchor = checkpoint.playbackAnchor
    this.playbackError = checkpoint.playbackError
  }

  updatePlayback(value: Record<string, unknown>, context: MatchMediaContext): MatchMediaStatus {
    const snapshot = parseSnapshot(value)
    const active = this.activePlayback
    if (!active) {
      throw new MatchSessionError(
        'MEDIA_PLAYBACK_SESSION_MISMATCH',
        'No active playback session exists'
      )
    }
    if (active.binding.provider === 'bilibili') {
      throw new MatchSessionError(
        'MEDIA_PLAYBACK_UNSUPPORTED',
        'This provider cannot report trusted playback time'
      )
    }
    if (
      snapshot.playback_session_id !== active.playback_session_id ||
      snapshot.binding_version_id !== active.binding_version_id ||
      active.groupName !== context.groupName ||
      active.contestantName !== context.contestantName ||
      mediaKey(snapshot) !== mediaKey(active.binding)
    ) {
      throw new MatchSessionError(
        'MEDIA_PLAYBACK_SESSION_MISMATCH',
        'Playback session does not match the active context'
      )
    }
    if (this.playbackAnchor && snapshot.sequence <= this.playbackAnchor.sequence) {
      throw new MatchSessionError('MEDIA_PLAYBACK_INVALID', 'Playback sequence must increase')
    }
    this.playbackAnchor = {
      ...snapshot,
      groupName: context.groupName,
      contestantName: context.contestantName,
      received_at_monotonic_ms: this.monotonicNow()
    }
    this.playbackError = false
    return this.capture(context).status
  }

  reportPlaybackError(
    value: Record<string, unknown>,
    context: MatchMediaContext
  ): MatchMediaStatus {
    const active = this.activePlayback
    if (
      !active ||
      !boundedId(value.playback_session_id) ||
      !boundedId(value.binding_version_id) ||
      value.playback_session_id !== active.playback_session_id ||
      value.binding_version_id !== active.binding_version_id ||
      active.groupName !== context.groupName ||
      active.contestantName !== context.contestantName ||
      !boundedId(value.code)
    ) {
      throw new MatchSessionError(
        'MEDIA_PLAYBACK_SESSION_MISMATCH',
        'Playback error does not match the active context'
      )
    }
    this.playbackAnchor = null
    this.playbackError = true
    return 'error'
  }

  capture(context: MatchMediaContext): MatchMediaCapture {
    const active = this.activePlayback
    if (!active) return emptyCapture('not_ready')
    if (
      active.groupName !== context.groupName ||
      active.contestantName !== context.contestantName
    ) {
      return bindingCapture(active.binding, null, 'context_mismatch')
    }
    if (this.playbackError) return bindingCapture(active.binding, null, 'error')
    if (active.binding.provider === 'bilibili') {
      return bindingCapture(active.binding, null, 'unsupported')
    }
    const anchor = this.playbackAnchor
    if (!anchor) return bindingCapture(active.binding, null, 'not_ready')
    const ageMs = Math.max(0, this.monotonicNow() - anchor.received_at_monotonic_ms)
    if (ageMs > 500) return bindingCapture(active.binding, null, 'stale')
    if (anchor.state === 'buffering' || anchor.state === 'not_ready') {
      return bindingCapture(active.binding, null, 'not_ready')
    }
    const advanced = anchor.state === 'playing' ? ageMs * anchor.playback_rate : 0
    return bindingCapture(active.binding, Math.round(anchor.position_ms + advanced), 'aligned')
  }

  private monotonicNow(): number {
    return (this.dependencies.monotonicNow ?? (() => performance.now()))()
  }
}

function parseSnapshot(value: Record<string, unknown>): MediaPlaybackSnapshot {
  const state = stringValue(value.state)
  const provider = stringValue(value.provider)
  const positionMs = Number(value.position_ms)
  const durationMs = value.duration_ms === null ? null : Number(value.duration_ms)
  const playbackRate = Number(value.playback_rate)
  const sequence = Number(value.sequence)
  if (
    !boundedId(value.playback_session_id) ||
    !boundedId(value.binding_version_id) ||
    (provider !== 'youtube' && provider !== 'bilibili') ||
    !boundedId(value.media_id) ||
    typeof value.segment !== 'string' ||
    value.segment.length > 64 ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !Number.isSafeInteger(positionMs) ||
    positionMs < 0 ||
    (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs < 0)) ||
    (durationMs !== null && positionMs > durationMs + 2000) ||
    !['not_ready', 'cued', 'playing', 'paused', 'buffering', 'ended'].includes(state) ||
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0 ||
    playbackRate > 4
  ) {
    throw new MatchSessionError('MEDIA_PLAYBACK_INVALID', 'Playback snapshot is invalid')
  }
  return {
    playback_session_id: String(value.playback_session_id),
    binding_version_id: String(value.binding_version_id),
    sequence,
    provider,
    media_id: String(value.media_id),
    segment: String(value.segment),
    position_ms: positionMs,
    duration_ms: durationMs,
    state: state as MediaPlaybackState,
    playback_rate: playbackRate
  }
}

function emptyCapture(status: MatchMediaStatus): MatchMediaCapture {
  return {
    bindingVersionId: null,
    provider: '',
    mediaId: '',
    segment: '',
    mediaTimeMs: null,
    status
  }
}

function bindingCapture(
  binding: MediaBinding,
  mediaTimeMs: number | null,
  status: MatchMediaStatus
): MatchMediaCapture {
  return {
    bindingVersionId: binding.version_id,
    provider: binding.provider,
    mediaId: binding.media_id,
    segment: binding.segment,
    mediaTimeMs,
    status
  }
}

function validateContestant(groupName: string, contestantName: string): void {
  if (!boundedId(groupName) || !boundedId(contestantName)) {
    throw new MatchSessionError('MEDIA_BINDING_CONTEXT_NOT_FOUND', 'Media context is invalid')
  }
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
