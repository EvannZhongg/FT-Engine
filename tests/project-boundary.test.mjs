import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('keeps project lifecycle operations off the legacy backend', () => {
  const store = readFileSync(
    new URL('../src/renderer/src/stores/refereeStore.js', import.meta.url),
    'utf8'
  )
  for (const endpoint of [
    '/api/project/create',
    '/api/project/update_groups',
    '/api/projects/list',
    '/api/project/load',
    '/api/project/delete'
  ]) {
    assert.equal(store.includes(endpoint), false, endpoint)
  }
  for (const method of ['create', 'update', 'get', 'list', 'delete']) {
    assert.equal(store.includes(`ftEngine.projects.${method}`), true, method)
  }
})
