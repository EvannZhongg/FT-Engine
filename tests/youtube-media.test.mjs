import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeYouTubeUrl } from '../src/shared/media/youtube.mts'

test('normalizes supported YouTube URLs to one canonical binding', () => {
  const videoId = 'dQw4w9WgXcQ'
  for (const url of [
    `https://www.youtube.com/watch?v=${videoId}&t=12`,
    `https://youtu.be/${videoId}?si=demo`,
    `https://youtube.com/shorts/${videoId}`,
    `https://m.youtube.com/embed/${videoId}`,
    `youtube.com/live/${videoId}`
  ]) {
    assert.deepEqual(normalizeYouTubeUrl(url), {
      provider: 'youtube',
      video_id: videoId,
      canonical_url: `https://www.youtube.com/watch?v=${videoId}`
    })
  }
})

test('rejects non-HTTPS, deceptive hosts and invalid video ids', () => {
  for (const url of [
    'http://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=short',
    'https://youtube.com/channel/dQw4w9WgXcQ'
  ]) {
    assert.throws(() => normalizeYouTubeUrl(url), /MEDIA_URL_/)
  }
})
