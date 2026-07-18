import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LEGACY_SHADOW_EVENT_PREFIX,
  parseLegacyShadowEventLine
} from '../src/main/legacy/shadow-event.mts'


test('ignores ordinary backend log lines', () => {
  assert.equal(parseLegacyShadowEventLine('INFO server started'), null)
})

test('maps a legacy snapshot to an immutable SQLite event', () => {
  const snapshot = {
    group_name: 'Open',
    ref_index: 2,
    contestant_name: 'Alice',
    system_time: '2026-07-18 10:00:00.100',
    ble_timestamp: 123,
    device_role: 'SECONDARY',
    current_total: 2,
    event_type: -1,
    total_plus: 3,
    total_minus: 4,
    major_penalty: 6,
    event_id: 'event-1',
    media_provider: 'youtube',
    media_id: 'dQw4w9WgXcQ',
    media_time_ms: 4500,
    media_sync_status: 'aligned'
  }
  const event = parseLegacyShadowEventLine(
    LEGACY_SHADOW_EVENT_PREFIX + JSON.stringify(snapshot)
  )
  assert.deepEqual(event, {
    eventId: 'event-1',
    matchSessionId: null,
    refereeId: null,
    connectionId: 'legacy-ref-2-secondary',
    deviceId: 'legacy-ref-2-secondary',
    role: 'secondary',
    eventType: -1,
    deviceTimestampMs: 123,
    receivedAt: '2026-07-18 10:00:00.100',
    systemTime: '2026-07-18 10:00:00.100',
    totalPlus: 3,
    totalMinus: 4,
    currentTotal: 2,
    majorPenalty: 6,
    mediaProvider: 'youtube',
    mediaId: 'dQw4w9WgXcQ',
    mediaTimeMs: 4500,
    mediaSyncStatus: 'aligned'
  })
})

test('rejects a malformed prefixed event', () => {
  assert.throws(
    () => parseLegacyShadowEventLine(`${LEGACY_SHADOW_EVENT_PREFIX}{"ref_index":"bad"}`),
    /Invalid legacy shadow event/
  )
})
