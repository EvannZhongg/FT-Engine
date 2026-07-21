import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BILIBILI_CAPABILITIES,
  BilibiliPlayerAdapter
} from '../src/renderer/src/media/adapters/bilibili-player-adapter.js'
import {
  YOUTUBE_CAPABILITIES,
  YouTubePlayerAdapter
} from '../src/renderer/src/media/adapters/youtube-player-adapter.js'

const youtubeBinding = (overrides = {}) => ({
  id: 'binding-alice',
  contestant_id: 'alice-id',
  version_id: 'version-alice-1',
  revision: 1,
  provider: 'youtube',
  media_id: 'dQw4w9WgXcQ',
  segment: '',
  canonical_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  updated_at: '2026-07-21T00:00:00.000Z',
  ...overrides
})

test('keeps the YouTube player instance and position for same-media continuity', async () => {
  const instances = []
  class FakePlayer {
    constructor(_host, options) {
      this.videoId = options.videoId
      this.position = 4.5
      this.seeks = []
      this.destroyed = false
      instances.push(this)
      queueMicrotask(() => options.events.onReady())
    }
    getVideoData() {
      return { video_id: this.videoId }
    }
    getCurrentTime() {
      return this.position
    }
    getDuration() {
      return 120
    }
    getPlayerState() {
      return 2
    }
    getPlaybackRate() {
      return 1
    }
    seekTo(seconds) {
      this.position = seconds
      this.seeks.push(seconds)
    }
    cueVideoById({ videoId, startSeconds = 0 }) {
      this.videoId = videoId
      this.position = startSeconds
    }
    destroy() {
      this.destroyed = true
    }
  }
  globalThis.window = { YT: { Player: FakePlayer } }
  const snapshots = []
  const adapter = new YouTubePlayerAdapter({}, { onSnapshot: (value) => snapshots.push(value) })
  assert.equal(adapter.capabilities, YOUTUBE_CAPABILITIES)
  const alice = youtubeBinding()
  await adapter.load(alice, 'playback-alice', 'reset')
  await new Promise((resolve) => setImmediate(resolve))
  const player = instances[0]
  player.position = 12.5
  const seeksBeforeContinue = player.seeks.length
  const bob = youtubeBinding({
    id: 'binding-bob',
    contestant_id: 'bob-id',
    version_id: 'version-bob-1'
  })
  await adapter.load(bob, 'playback-bob', 'continue', 12500)
  assert.equal(instances.length, 1)
  assert.equal(player.seeks.length, seeksBeforeContinue)
  assert.equal(player.position, 12.5)
  const snapshot = await adapter.getSnapshot()
  assert.equal(snapshot.playback_session_id, 'playback-bob')
  assert.equal(snapshot.binding_version_id, 'version-bob-1')
  assert.equal(snapshot.position_ms, 12500)

  await adapter.load(bob, 'playback-bob-reset', 'reset')
  assert.equal(player.position, 0)
  assert.equal(YOUTUBE_CAPABILITIES.preserve_position, true)
  assert.ok(snapshots.length > 0)
  await adapter.destroy()
  delete globalThis.window
})

test('keeps Bilibili at embed-only capability and rejects continuity', async () => {
  const frame = { src: '' }
  const adapter = new BilibiliPlayerAdapter(frame)
  assert.equal(adapter.capabilities, BILIBILI_CAPABILITIES)
  const binding = {
    ...youtubeBinding(),
    provider: 'bilibili',
    media_id: 'BV1xx411c7mD',
    segment: 'p=2',
    canonical_url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2'
  }
  await adapter.load(binding, 'playback-bilibili', 'reset')
  const loaded = new URL(frame.src)
  assert.equal(loaded.origin, 'https://player.bilibili.com')
  assert.equal(loaded.searchParams.get('bvid'), binding.media_id)
  assert.equal(loaded.searchParams.get('p'), '2')
  assert.equal(await adapter.getSnapshot(), null)
  assert.equal(BILIBILI_CAPABILITIES.time_sync, false)
  assert.equal(BILIBILI_CAPABILITIES.preserve_position, false)
  await assert.rejects(adapter.load(binding, 'another-session', 'continue'), {
    message: 'MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE'
  })
  await adapter.destroy()
  assert.equal(frame.src, 'about:blank')
})
