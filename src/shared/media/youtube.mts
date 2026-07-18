export interface YouTubeMediaBinding {
  provider: 'youtube'
  video_id: string
  canonical_url: string
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com'
])

export function normalizeYouTubeUrl(value: unknown): YouTubeMediaBinding {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > 2048) throw new Error('MEDIA_URL_INVALID')

  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    throw new Error('MEDIA_URL_INVALID')
  }
  if (url.protocol !== 'https:') throw new Error('MEDIA_URL_INVALID')

  const host = url.hostname.toLowerCase()
  let videoId = ''
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || ''
  } else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean)
    if (url.pathname.replace(/\/$/, '') === '/watch') {
      videoId = url.searchParams.get('v') || ''
    } else if (parts.length >= 2 && ['shorts', 'embed', 'live'].includes(parts[0])) {
      videoId = parts[1]
    }
  } else {
    throw new Error('MEDIA_URL_UNSUPPORTED')
  }

  if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error('MEDIA_URL_INVALID')
  return {
    provider: 'youtube',
    video_id: videoId,
    canonical_url: `https://www.youtube.com/watch?v=${videoId}`
  }
}
