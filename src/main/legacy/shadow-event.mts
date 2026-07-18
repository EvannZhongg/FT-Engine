import type { StoredScoreEvent } from '../persistence/local-database.mts'


export const LEGACY_SHADOW_EVENT_PREFIX = 'FT_SHADOW_EVENT '

interface LegacyScoreSnapshot {
  ref_index: number
  system_time: string
  ble_timestamp: number
  device_role: 'PRIMARY' | 'SECONDARY'
  current_total: number
  event_type: number
  total_plus: number
  total_minus: number
  major_penalty: number
  event_id: string
  media_provider?: string
  media_id?: string
  media_time_ms?: number | null
  media_sync_status?: string
}

export function parseLegacyShadowEventLine(line: string): StoredScoreEvent | null {
  if (!line.startsWith(LEGACY_SHADOW_EVENT_PREFIX)) return null
  const value = JSON.parse(line.slice(LEGACY_SHADOW_EVENT_PREFIX.length)) as LegacyScoreSnapshot
  if (
    !value ||
    !Number.isSafeInteger(value.ref_index) ||
    typeof value.system_time !== 'string' ||
    !value.system_time ||
    (value.device_role !== 'PRIMARY' && value.device_role !== 'SECONDARY')
  ) {
    throw new Error('Invalid legacy shadow event')
  }
  const role = value.device_role === 'PRIMARY' ? 'primary' : 'secondary'
  return {
    eventId: value.event_id,
    matchSessionId: null,
    refereeId: null,
    connectionId: `legacy-ref-${value.ref_index}-${role}`,
    deviceId: `legacy-ref-${value.ref_index}-${role}`,
    role,
    eventType: value.event_type,
    deviceTimestampMs: value.ble_timestamp,
    receivedAt: value.system_time,
    systemTime: value.system_time,
    totalPlus: value.total_plus,
    totalMinus: value.total_minus,
    currentTotal: value.current_total,
    majorPenalty: value.major_penalty,
    mediaProvider: value.media_provider ?? '',
    mediaId: value.media_id ?? '',
    mediaTimeMs: value.media_time_ms ?? null,
    mediaSyncStatus: value.media_sync_status ?? 'not_ready'
  }
}
