import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('keeps export bytes and file writes out of the Renderer', () => {
  const store = readFileSync(
    new URL('../src/renderer/src/stores/replayStore.js', import.meta.url),
    'utf8'
  )
  const report = readFileSync(
    new URL('../src/renderer/src/components/ReportView.vue', import.meta.url),
    'utf8'
  )
  for (const source of [store, report]) {
    assert.equal(source.includes('/api/export'), false)
    assert.equal(source.includes('createObjectURL'), false)
    assert.equal(source.includes('new Blob'), false)
    assert.equal(source.includes('data:text/csv'), false)
  }
  assert.equal(store.includes('ftEngine.exports.saveDetails'), true)
  assert.equal(store.includes('ftEngine.exports.saveReport'), true)
})
