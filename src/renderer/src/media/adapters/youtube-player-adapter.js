import { loadYouTubeApi, playerStateName } from '../youtube.js'

export const YOUTUBE_CAPABILITIES = Object.freeze({
  embed: true,
  play_pause: true,
  seek: true,
  playback_rate: true,
  time_sync: true,
  seek_by_reload: false,
  preserve_position: true
})

export class YouTubePlayerAdapter {
  constructor(host, { onSnapshot, onError } = {}) {
    this.capabilities = YOUTUBE_CAPABILITIES
    this.host = host
    this.onSnapshot = onSnapshot
    this.onError = onError
    this.player = null
    this.binding = null
    this.playbackSessionId = ''
    this.sequence = 0
    this.pollTimer = null
    this.destroyed = false
    this.pendingLoad = null
    this.readyPromise = null
    this.resolveReady = null
  }

  async load(binding, playbackSessionId, progressMode = 'reset', continuityPositionMs = null) {
    if (!binding || binding.provider !== 'youtube') throw new Error('MEDIA_URL_UNSUPPORTED')
    this.binding = binding
    this.playbackSessionId = playbackSessionId
    this.sequence = 0
    const position = Math.max(0, Number(continuityPositionMs) || 0)
    if (!this.player) {
      this.pendingLoad = { binding, progressMode, position }
      this.readyPromise = new Promise((resolve) => {
        this.resolveReady = resolve
      })
      const YT = await loadYouTubeApi()
      if (this.destroyed) return
      this.player = new YT.Player(this.host, {
        videoId: binding.media_id,
        width: '100%',
        height: '100%',
        playerVars: { controls: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            const pending = this.pendingLoad
            this.pendingLoad = null
            if (pending?.progressMode === 'continue' && pending.position > 0) {
              this.player.seekTo(pending.position / 1000, true)
            } else if (pending?.progressMode === 'reset') {
              this.player.seekTo(0, true)
            }
            this.startPolling()
            this.publishSnapshot()
            this.resolveReady?.()
            this.resolveReady = null
          },
          onStateChange: () => this.publishSnapshot(),
          onPlaybackRateChange: () => this.publishSnapshot(),
          onError: (event) => {
            this.onError?.({
              code: [100, 101, 150].includes(event.data)
                ? 'MEDIA_PLAYER_UNAVAILABLE'
                : 'MEDIA_PLAYER_ERROR',
              provider: 'youtube',
              details: event.data
            })
            this.resolveReady?.()
            this.resolveReady = null
          }
        }
      })
      await this.readyPromise
      return
    }
    const currentId = this.player.getVideoData?.().video_id || ''
    if (currentId !== binding.media_id) {
      if (progressMode === 'continue') throw new Error('MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE')
      this.player.cueVideoById({ videoId: binding.media_id, startSeconds: 0 })
    } else if (progressMode === 'reset') {
      await this.seekTo(0)
    }
    this.startPolling()
    this.publishSnapshot()
  }

  async play() {
    this.player?.playVideo?.()
  }
  async pause() {
    this.player?.pauseVideo?.()
  }

  async seekTo(positionMs) {
    if (!this.player?.seekTo) return
    this.player.seekTo(Math.max(0, Number(positionMs) || 0) / 1000, true)
    this.publishSnapshot()
  }

  async getSnapshot() {
    return this.readSnapshot()
  }

  async destroy() {
    this.destroyed = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.player?.destroy?.()
    this.player = null
    this.resolveReady?.()
    this.resolveReady = null
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => this.publishSnapshot(), 100)
  }

  publishSnapshot() {
    const snapshot = this.readSnapshot()
    if (snapshot) this.onSnapshot?.(snapshot)
  }

  readSnapshot() {
    if (!this.player || !this.binding || typeof this.player.getCurrentTime !== 'function')
      return null
    const state = playerStateName(this.player.getPlayerState?.())
    if (state === 'not_ready') return null
    const duration = Number(this.player.getDuration?.())
    return {
      playback_session_id: this.playbackSessionId,
      binding_version_id: this.binding.version_id,
      sequence: ++this.sequence,
      provider: 'youtube',
      media_id: this.binding.media_id,
      segment: this.binding.segment,
      position_ms: Math.max(0, Math.round((this.player.getCurrentTime() || 0) * 1000)),
      duration_ms: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null,
      state,
      playback_rate: Number(this.player.getPlaybackRate?.()) || 1
    }
  }
}
