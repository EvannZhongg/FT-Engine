export const BILIBILI_CAPABILITIES = Object.freeze({
  embed: true,
  play_pause: false,
  seek: false,
  playback_rate: false,
  time_sync: false,
  seek_by_reload: true,
  preserve_position: false
})

export class BilibiliPlayerAdapter {
  constructor(frame) {
    this.capabilities = BILIBILI_CAPABILITIES
    this.frame = frame
    this.binding = null
    this.playbackSessionId = ''
  }

  async load(binding, playbackSessionId, progressMode = 'reset', continuityPositionMs = null) {
    if (!binding || binding.provider !== 'bilibili') throw new Error('MEDIA_URL_UNSUPPORTED')
    if (progressMode === 'continue') throw new Error('MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE')
    this.binding = binding
    this.playbackSessionId = playbackSessionId
    const seconds = Math.max(0, Number(continuityPositionMs) || 0) / 1000
    const url = new URL('https://player.bilibili.com/player.html')
    url.searchParams.set('bvid', binding.media_id)
    url.searchParams.set('p', binding.segment.replace(/^p=/, '') || '1')
    url.searchParams.set('t', String(Math.floor(seconds)))
    url.searchParams.set('autoplay', '0')
    url.searchParams.set('danmaku', '0')
    this.frame.src = url.toString()
  }

  async play() {
    throw new Error('MEDIA_PLAYBACK_UNSUPPORTED')
  }
  async pause() {
    throw new Error('MEDIA_PLAYBACK_UNSUPPORTED')
  }
  async seekTo(positionMs) {
    return this.load(this.binding, this.playbackSessionId, 'reset', positionMs)
  }
  async getSnapshot() {
    return null
  }
  async destroy() {
    this.frame.src = 'about:blank'
  }
}
