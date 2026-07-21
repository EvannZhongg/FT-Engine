import type { ParsedMediaUrl } from './media-contract.mts'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com'
])
const BILIBILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'])
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const BV_ID = /^BV[0-9A-Za-z]{10}$/
const SHORT_URL_HOP_TIMEOUT_MS = 3000
const SHORT_URL_TOTAL_TIMEOUT_MS = 10000

export function normalizeMediaUrl(value: unknown): ParsedMediaUrl {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > 2048) throw mediaError('MEDIA_URL_INVALID')
  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    throw mediaError('MEDIA_URL_INVALID')
  }
  assertDirectUrl(url)
  const host = url.hostname.toLowerCase()
  if (host === 'youtu.be' || YOUTUBE_HOSTS.has(host)) return normalizeYouTube(url, host)
  if (BILIBILI_HOSTS.has(host)) return normalizeBilibili(url)
  if (host === 'b23.tv') throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
  throw mediaError('MEDIA_URL_UNSUPPORTED')
}

export function normalizeYouTubeUrl(value: unknown): ParsedMediaUrl {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > 2048) throw mediaError('MEDIA_URL_INVALID')
  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    throw mediaError('MEDIA_URL_INVALID')
  }
  assertDirectUrl(url)
  const host = url.hostname.toLowerCase()
  if (host !== 'youtu.be' && !YOUTUBE_HOSTS.has(host)) throw mediaError('MEDIA_URL_UNSUPPORTED')
  return normalizeYouTube(url, host)
}

export function normalizeBilibiliUrl(value: unknown): ParsedMediaUrl {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > 2048) throw mediaError('MEDIA_URL_INVALID')
  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    throw mediaError('MEDIA_URL_INVALID')
  }
  assertDirectUrl(url)
  if (!BILIBILI_HOSTS.has(url.hostname.toLowerCase())) throw mediaError('MEDIA_URL_UNSUPPORTED')
  return normalizeBilibili(url)
}

interface ShortUrlResolverDependencies {
  fetch?: typeof fetch
  lookup?: typeof lookup
}

export async function resolveAndNormalizeMediaUrl(
  value: unknown,
  dependencies: ShortUrlResolverDependencies = {}
): Promise<ParsedMediaUrl> {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > 2048) throw mediaError('MEDIA_URL_INVALID')
  let parsed: URL
  try {
    parsed = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    throw mediaError('MEDIA_URL_INVALID')
  }
  assertDirectUrl(parsed)
  if (parsed.hostname.toLowerCase() !== 'b23.tv') return normalizeMediaUrl(raw)
  let current = parsed
  let redirects = 0
  const totalSignal = AbortSignal.timeout(SHORT_URL_TOTAL_TIMEOUT_MS)
  while (true) {
    const host = current.hostname.toLowerCase()
    if (host !== 'b23.tv' && !BILIBILI_HOSTS.has(host))
      throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
    await assertPublicHost(host, dependencies.lookup ?? lookup)
    const response = await (dependencies.fetch ?? fetch)(current, {
      method: 'HEAD',
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.any([totalSignal, AbortSignal.timeout(SHORT_URL_HOP_TIMEOUT_MS)])
    }).catch(() => null)
    if (!response) throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
      try {
        current = new URL(location, current)
      } catch {
        throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
      }
      if (current.protocol !== 'https:' || current.port || current.username || current.password) {
        throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
      }
      redirects += 1
      if (redirects > 3) throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
      continue
    }
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !BILIBILI_HOSTS.has(current.hostname.toLowerCase())
    ) {
      throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
    }
    return normalizeBilibili(current)
  }
}

function normalizeYouTube(url: URL, host: string): ParsedMediaUrl {
  let mediaId = ''
  if (host === 'youtu.be') mediaId = url.pathname.split('/').filter(Boolean)[0] || ''
  else if (url.pathname.replace(/\/$/, '') === '/watch') mediaId = url.searchParams.get('v') || ''
  else {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length >= 2 && ['shorts', 'embed', 'live'].includes(parts[0])) mediaId = parts[1]
  }
  if (!YOUTUBE_ID.test(mediaId)) throw mediaError('MEDIA_URL_INVALID')
  return {
    provider: 'youtube',
    media_id: mediaId,
    segment: '',
    canonical_url: `https://www.youtube.com/watch?v=${mediaId}`,
    embed_url: `https://www.youtube-nocookie.com/embed/${mediaId}`
  }
}

function normalizeBilibili(url: URL): ParsedMediaUrl {
  const parts = url.pathname.split('/').filter(Boolean)
  const mediaId = parts.length === 2 && parts[0].toLowerCase() === 'video' ? parts[1] : ''
  if (!BV_ID.test(mediaId)) throw mediaError('MEDIA_URL_INVALID')
  const part = url.searchParams.get('p') || '1'
  if (!/^[1-9][0-9]{0,3}$/.test(part)) throw mediaError('MEDIA_URL_INVALID')
  const segment = `p=${Number(part)}`
  return {
    provider: 'bilibili',
    media_id: mediaId,
    segment,
    canonical_url: `https://www.bilibili.com/video/${mediaId}/?p=${Number(part)}`,
    embed_url: `https://player.bilibili.com/player.html?bvid=${mediaId}&p=${Number(part)}&autoplay=0&danmaku=0`
  }
}

function mediaError(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string }
  error.code = code
  return error
}

function assertDirectUrl(url: URL): void {
  if (url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw mediaError('MEDIA_URL_INVALID')
  }
}

async function assertPublicHost(host: string, resolve: typeof lookup): Promise<void> {
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await resolve(host, { all: true, verbatim: true })
  } catch {
    throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw mediaError('MEDIA_SHORT_URL_RESOLVE_FAILED')
  }
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const value = ipv4Number(address)
    return PRIVATE_IPV4_RANGES.some(([network, prefix]) => isInIpv4Subnet(value, network, prefix))
  }
  if (family === 6) {
    const normalized = address.toLowerCase().split('%')[0]
    const mapped = mappedIpv4Address(normalized)
    if (mapped) return isPrivateAddress(mapped)
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('ff') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    )
  }
  return true
}

const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [ipv4Number('0.0.0.0'), 8],
  [ipv4Number('10.0.0.0'), 8],
  [ipv4Number('100.64.0.0'), 10],
  [ipv4Number('127.0.0.0'), 8],
  [ipv4Number('169.254.0.0'), 16],
  [ipv4Number('172.16.0.0'), 12],
  [ipv4Number('192.0.0.0'), 24],
  [ipv4Number('192.0.2.0'), 24],
  [ipv4Number('192.88.99.0'), 24],
  [ipv4Number('192.168.0.0'), 16],
  [ipv4Number('198.18.0.0'), 15],
  [ipv4Number('198.51.100.0'), 24],
  [ipv4Number('203.0.113.0'), 24],
  [ipv4Number('224.0.0.0'), 4],
  [ipv4Number('240.0.0.0'), 4]
]

function ipv4Number(address: string): number {
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => (value * 256 + octet) >>> 0, 0)
}

function isInIpv4Subnet(value: number, network: number, prefix: number): boolean {
  const divisor = 2 ** (32 - prefix)
  return Math.floor(value / divisor) === Math.floor(network / divisor)
}

function mappedIpv4Address(address: string): string | null {
  const tail = address.match(/^::ffff:(.+)$/)?.[1]
  if (!tail) return null
  if (isIP(tail) === 4) return tail
  const words = tail.split(':')
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null
  const value = Number.parseInt(words[0], 16) * 65536 + Number.parseInt(words[1], 16)
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}
