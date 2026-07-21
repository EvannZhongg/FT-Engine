import assert from 'node:assert/strict'
import test from 'node:test'

import { buildReplayScores } from '../src/renderer/src/media/replayScores.mjs'

const event = (overrides = {}) => ({
  referee_index: 1,
  referee_name: 'Judge A',
  system_time: '2026-07-18 10:00:00.100',
  media_sync_status: 'aligned',
  media_binding_version_id: 'version-1',
  media_id: 'dQw4w9WgXcQ',
  media_time_ms: 1000,
  current_total: 1,
  total_plus: 1,
  total_minus: 0,
  major_penalty: 0,
  ...overrides
})

test('rebuilds each referee score at the current video time', () => {
  const events = [
    event(),
    event({ media_time_ms: 2000, current_total: 2, total_plus: 2 }),
    event({ referee_index: 2, referee_name: 'Judge B', current_total: -1, total_minus: 1 })
  ]
  const scores = buildReplayScores(
    events,
    [
      { index: 1, name: 'Judge A', mode: 'SINGLE' },
      { index: 2, name: 'Judge B', mode: 'DUAL' }
    ],
    'version-1',
    1500
  )

  assert.equal(scores[1].total, 1)
  assert.equal(scores[2].minus, 1)
  assert.equal(scores[2].mode, 'DUAL')
})

test('ignores unaligned events, other videos and future events', () => {
  const events = [
    event(),
    event({ media_time_ms: 1100, current_total: 9, media_sync_status: 'stale' }),
    event({ media_time_ms: 1200, current_total: 8, media_binding_version_id: 'version-2' }),
    event({ media_time_ms: 3000, current_total: 7 })
  ]
  const scores = buildReplayScores(events, [], 'version-1', 2000)
  assert.equal(scores[1].total, 1)
})

test('uses the latest system event when video is paused at one timestamp', () => {
  const events = [
    event(),
    event({
      system_time: '2026-07-18 10:00:00.300',
      current_total: 2,
      total_plus: 2
    })
  ]
  const scores = buildReplayScores(events, [], 'version-1', 1000)
  assert.equal(scores[1].total, 2)
  assert.equal(scores[1].plus, 2)
})

test('keeps configured referees visible before their first event', () => {
  const scores = buildReplayScores(
    [],
    [{ index: 3, name: 'Judge C', mode: 'SINGLE' }],
    'version-1',
    0
  )
  assert.deepEqual(scores[3], {
    name: 'Judge C',
    mode: 'SINGLE',
    total: 0,
    plus: 0,
    minus: 0,
    penalty: 0
  })
})
