import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  applyDeviceCounterEvent,
  createRefereeScoringState,
  resetRefereeScoringState,
  ScoringDomainError
} from '../src/main/domain/scoring.mts'


const cases = JSON.parse(readFileSync(new URL('./fixtures/scoring-cases.json', import.meta.url)))

for (const scoringCase of cases) {
  test(`matches legacy scoring: ${scoringCase.name}`, () => {
    let state = createRefereeScoringState(scoringCase.mode)
    for (const event of scoringCase.events) {
      state = applyDeviceCounterEvent(state, event)
    }
    assert.deepEqual(state.score, scoringCase.expected)
  })
}

test('does not mutate state and ignores a duplicate event id', () => {
  const initial = createRefereeScoringState('SINGLE')
  const event = {
    eventId: 'event-1',
    role: 'primary',
    eventType: 1,
    totalPlus: 1,
    totalMinus: 0,
    deviceTimestampMs: 10
  }
  const applied = applyDeviceCounterEvent(initial, event)
  const duplicate = applyDeviceCounterEvent(applied, event)
  assert.notEqual(applied, initial)
  assert.equal(duplicate, applied)
  assert.deepEqual(initial.score, { total: 0, plus: 0, minus: 0, penalty: 0 })
})

test('supports an explicit local reset without forgetting deduplication ids', () => {
  const applied = applyDeviceCounterEvent(createRefereeScoringState('SINGLE'), {
    eventId: 'event-before-reset',
    role: 'primary',
    eventType: 1,
    totalPlus: 3,
    totalMinus: 0,
    deviceTimestampMs: 10
  })
  const reset = resetRefereeScoringState(applied)
  assert.deepEqual(reset.score, { total: 0, plus: 0, minus: 0, penalty: 0 })
  assert.deepEqual(reset.processedEventIds, ['event-before-reset'])
})

test('rejects invalid counter snapshots', () => {
  assert.throws(() => applyDeviceCounterEvent(createRefereeScoringState('SINGLE'), {
    eventId: 'invalid',
    role: 'primary',
    eventType: 1,
    totalPlus: -1,
    totalMinus: 0,
    deviceTimestampMs: 10
  }), ScoringDomainError)
})
