import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  MEDIA_SWITCH_PHASES,
  canContinueMediaPosition,
  createSwitchOperationGate,
  mediaKey
} from '../src/renderer/src/features/scoring/mediaSwitch.mjs'

const binding = (overrides = {}) => ({
  provider: 'youtube',
  media_id: 'dQw4w9WgXcQ',
  segment: '',
  ...overrides
})

test('allows only one contestant switch operation until it completes or is cancelled', () => {
  const gate = createSwitchOperationGate()
  const first = gate.begin()
  assert.equal(typeof first, 'number')
  assert.equal(gate.begin(), null)
  assert.equal(gate.isCurrent(first), true)
  assert.equal(gate.finish(first + 1), false)
  assert.equal(gate.isActive(), true)
  assert.equal(gate.finish(first), true)
  const second = gate.begin()
  assert.ok(second > first)
  gate.cancel()
  assert.equal(gate.isCurrent(second), false)
  assert.equal(gate.isActive(), false)
})

test('allows continuity only for aligned YouTube playback with the full same media key', () => {
  const active = binding()
  const target = binding()
  assert.equal(mediaKey(active), 'youtube:dQw4w9WgXcQ:')
  assert.equal(canContinueMediaPosition(active, target, 'aligned'), true)
  assert.equal(canContinueMediaPosition(active, target, 'stale'), false)
  assert.equal(
    canContinueMediaPosition(active, binding({ media_id: 'aqz-KE-bpKQ' }), 'aligned'),
    false
  )
  assert.equal(
    canContinueMediaPosition(
      binding({ provider: 'bilibili', media_id: 'BV1xx411c7mD', segment: 'p=1' }),
      binding({ provider: 'bilibili', media_id: 'BV1xx411c7mD', segment: 'p=1' }),
      'aligned'
    ),
    false
  )
  assert.deepEqual(MEDIA_SWITCH_PHASES.at(0), 'idle')
  assert.deepEqual(MEDIA_SWITCH_PHASES.at(-1), 'ready')
})

test('routes every ScoreBoard contestant entry through one switch request boundary', () => {
  const source = readFileSync(
    new URL('../src/renderer/src/components/ScoreBoard.vue', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(source, /\.setContext\(|\.setMatchContext\(|setMediaBinding\(/)
  assert.equal(source.match(/store\.transitionMatchContext\(/g)?.length, 1)
  for (const handler of [
    'handleNextClick',
    'manualChange',
    'onSelectPlayer',
    'executeShortcutAction',
    'continueLoopMatch'
  ]) {
    assert.match(source, new RegExp(`const ${handler} =`))
  }
  assert.match(source, /const requestContestantSwitch =/)
  assert.ok((source.match(/requestContestantSwitch\(/g) || []).length >= 7)
})
