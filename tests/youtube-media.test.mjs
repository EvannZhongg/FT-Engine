import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeMediaUrl,
  normalizeYouTubeUrl,
  resolveAndNormalizeMediaUrl
} from '../src/shared/media/normalize-media-url.mts'

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
      media_id: videoId,
      segment: '',
      canonical_url: `https://www.youtube.com/watch?v=${videoId}`,
      embed_url: `https://www.youtube-nocookie.com/embed/${videoId}`
    })
  }
})

test('normalizes YouTube and Bilibili URLs through the unified contract', () => {
  assert.deepEqual(normalizeMediaUrl('youtube.com/watch?v=dQw4w9WgXcQ'), {
    provider: 'youtube',
    media_id: 'dQw4w9WgXcQ',
    segment: '',
    canonical_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    embed_url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
  })
  for (const url of [
    'https://www.bilibili.com/video/BV1xx411c7mD',
    'https://m.bilibili.com/video/BV1xx411c7mD?p=1'
  ]) {
    assert.deepEqual(normalizeMediaUrl(url), {
      provider: 'bilibili',
      media_id: 'BV1xx411c7mD',
      segment: 'p=1',
      canonical_url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=1',
      embed_url:
        'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&p=1&autoplay=0&danmaku=0'
    })
  }
  assert.equal(normalizeMediaUrl('bilibili.com/video/BV1xx411c7mD?p=23').segment, 'p=23')
})

test('rejects unsafe or malformed provider URLs', () => {
  for (const url of [
    'http://www.bilibili.com/video/BV1xx411c7mD',
    'https://bilibili.com.evil.test/video/BV1xx411c7mD',
    'https://user:secret@www.bilibili.com/video/BV1xx411c7mD',
    'https://www.bilibili.com:444/video/BV1xx411c7mD',
    'https://www.bilibili.com/archive/video/BV1xx411c7mD',
    'https://www.bilibili.com/video/av123',
    'https://www.bilibili.com/video/BV1xx411c7mD?p=0',
    'https://www.bilibili.com/video/BV1xx411c7mD?p=10000',
    `https://www.bilibili.com/video/${'x'.repeat(2050)}`
  ]) {
    assert.throws(() => normalizeMediaUrl(url), /MEDIA_URL_/)
  }
})

test('resolves Bilibili short links with bounded allowlisted redirects', async () => {
  const responses = new Map([
    ['https://b23.tv/demo', [302, 'https://www.bilibili.com/video/BV1xx411c7mD?p=2']],
    ['https://www.bilibili.com/video/BV1xx411c7mD?p=2', [200, null]]
  ])
  const parsed = await resolveAndNormalizeMediaUrl('https://b23.tv/demo', {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    fetch: async (url) => {
      const [status, location] = responses.get(String(url))
      return new Response(null, { status, headers: location ? { location } : {} })
    }
  })
  assert.equal(parsed.canonical_url, 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2')

  await assert.rejects(
    resolveAndNormalizeMediaUrl('https://b23.tv/private', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      fetch: async () => new Response(null, { status: 302 })
    }),
    { code: 'MEDIA_SHORT_URL_RESOLVE_FAILED' }
  )
  await assert.rejects(
    resolveAndNormalizeMediaUrl('https://b23.tv/evil', {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.test/video/BV1xx411c7mD' }
        })
    }),
    { code: 'MEDIA_SHORT_URL_RESOLVE_FAILED' }
  )
  await assert.rejects(
    resolveAndNormalizeMediaUrl('https://b23.tv/server-error', {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      fetch: async () => new Response(null, { status: 503 })
    }),
    { code: 'MEDIA_SHORT_URL_RESOLVE_FAILED' }
  )
  await assert.rejects(
    resolveAndNormalizeMediaUrl('https://b23.tv/mapped-private', {
      lookup: async () => [{ address: '::ffff:192.168.1.2', family: 6 }],
      fetch: async () => new Response(null, { status: 302 })
    }),
    { code: 'MEDIA_SHORT_URL_RESOLVE_FAILED' }
  )
  for (const address of ['100.64.0.1', '198.18.0.1', '::ffff:7f00:1']) {
    await assert.rejects(
      resolveAndNormalizeMediaUrl('https://b23.tv/non-public', {
        lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
        fetch: async () => new Response(null, { status: 302 })
      }),
      { code: 'MEDIA_SHORT_URL_RESOLVE_FAILED' }
    )
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
