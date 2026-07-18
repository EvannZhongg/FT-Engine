import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('keeps Electron live scoring off legacy HTTP and WebSocket transports', () => {
  const renderer = [
    'src/renderer/src/App.vue',
    'src/renderer/src/components/OverlayView.vue',
    'src/renderer/src/components/ScoreBoard.vue',
    'src/renderer/src/stores/refereeStore.js'
  ]
    .map(source)
    .join('\n')
  const main = source('src/main/index.js')

  for (const legacyTransport of [
    'new WebSocket',
    'connectWebSocket',
    '/setup',
    '/reset',
    '/teardown',
    '/api/match/set_context',
    '/api/media/playback/sync',
    '/api/project/media',
    'ws://127.0.0.1'
  ]) {
    assert.equal(renderer.includes(legacyTransport), false, legacyTransport)
  }
  assert.equal(main.includes('/teardown'), false)
})
