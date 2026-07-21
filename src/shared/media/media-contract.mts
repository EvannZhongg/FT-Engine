export type MediaProvider = 'youtube' | 'bilibili'

export interface MediaLocator {
  provider: MediaProvider
  media_id: string
  segment: string
}

export interface MediaBinding extends MediaLocator {
  id: string
  contestant_id: string
  version_id: string
  revision: number
  canonical_url: string
  updated_at: string
}

export interface MediaBindingVersion extends MediaLocator {
  id: string
  contestant_id: string
  revision: number
  canonical_url: string
  created_at: string
}

export interface ParsedMediaUrl extends MediaLocator {
  canonical_url: string
  embed_url: string
}

export interface MediaCapabilities {
  embed: boolean
  play_pause: boolean
  seek: boolean
  playback_rate: boolean
  time_sync: boolean
  seek_by_reload: boolean
  preserve_position: boolean
}

export type MediaProgressMode = 'continue' | 'reset'

export type MediaPlaybackState = 'not_ready' | 'cued' | 'playing' | 'paused' | 'buffering' | 'ended'

export interface MediaPlaybackSnapshot extends MediaLocator {
  playback_session_id: string
  binding_version_id: string
  sequence: number
  position_ms: number
  duration_ms: number | null
  state: MediaPlaybackState
  playback_rate: number
}

export interface ContextTransitionInput {
  group_name: string
  contestant_name: string
  binding_version_id: string | null
  progress_mode: MediaProgressMode
  expected_media_key: string | null
}

export interface ContextTransitionResult {
  group_name: string
  contestant_name: string
  binding: MediaBinding | null
  playback_session_id: string | null
  progress_mode: MediaProgressMode
  continuity_position_ms: number | null
}

export function mediaKey(value: MediaLocator): string {
  return `${value.provider}:${value.media_id}:${value.segment}`
}
