import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('exposes session completion and invalidation through typed IPC', () => {
  const contract = source('src/shared/ipc-contract.ts')
  const preload = source('src/preload/index.ts')
  const registration = source('src/main/ipc/register-matches.mts')
  const store = source('src/renderer/src/stores/matchStore.js')
  const scoringPage = source('src/renderer/src/features/scoring/ScoringPage.vue')
  const scoreboard = source('src/renderer/src/components/ScoreBoard.vue')

  assert.equal(contract.includes("invalidate: 'match:invalidate'"), true)
  assert.equal(preload.includes('IPC_CHANNELS.match.invalidate'), true)
  assert.equal(registration.includes('matchSession.completeCurrent()'), true)
  assert.equal(registration.includes('matchSession.invalidateCurrent()'), true)
  assert.equal(store.includes('result.sessionFinalized !== false'), true)
  assert.equal(store.includes('invalidateMatch()'), true)
  assert.equal(store.includes("this.finalizeMatch('invalidate')"), true)
  assert.equal(scoringPage.includes('@invalidate="invalidateMatch"'), true)
  assert.equal(scoreboard.includes("emit('invalidate')"), true)
  assert.equal(scoreboard.includes('showInvalidateDialog'), true)
})

test('keeps device control and Renderer notifications outside MatchSessionService', () => {
  const session = source('src/main/match/match-session.mts')
  const devices = source('src/main/match/match-device-session.mts')
  const notifier = source('src/main/match/match-session-notifier.mts')

  for (const implementation of [
    "'device.connectMany'",
    "'device.disconnectAll'",
    "'device.resetAll'",
    'this.dependencies.emitRefereeUpdate',
    'this.dependencies.emitContextUpdate',
    'this.dependencies.emitStatusUpdate'
  ]) {
    assert.equal(session.includes(implementation), false, implementation)
  }
  assert.equal(session.includes('new MatchDeviceSession'), true)
  assert.equal(session.includes('new MatchSessionNotifier'), true)
  assert.equal(devices.includes("'device.connectMany'"), true)
  assert.equal(devices.includes("'device.resetAll'"), true)
  assert.equal(notifier.includes('this.dependencies.emitStatusUpdate'), true)
  assert.equal(notifier.includes('MATCH_RENDERER_NOTIFY_FAILED'), true)
})
