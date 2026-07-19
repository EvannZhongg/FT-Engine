import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('routes Renderer settings through typed IPC', () => {
  const store = readFileSync(
    new URL('../src/renderer/src/stores/settingsStore.js', import.meta.url),
    'utf8'
  )
  assert.match(store, /ftEngine\.settings\.get/)
  assert.match(store, /ftEngine\.settings\.set/)
})
