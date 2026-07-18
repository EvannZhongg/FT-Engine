import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('routes the project lifecycle through typed IPC', () => {
  const store = readFileSync(
    new URL('../src/renderer/src/stores/refereeStore.js', import.meta.url),
    'utf8'
  )
  for (const method of ['create', 'update', 'get', 'list', 'delete']) {
    assert.equal(store.includes(`ftEngine.projects.${method}`), true, method)
  }
})

test('uses stable Competition and device field names across the desktop boundary', () => {
  const sources = [
    'src/shared/contracts/competition.mts',
    'src/shared/ipc-contract.ts',
    'src/preload/index.ts',
    'src/renderer/src/stores/refereeStore.js'
  ]
    .map((path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
    .join('\n')

  for (const legacy of ['project_name', 'source_key', 'dir_name', 'pri_addr', 'sec_addr']) {
    assert.equal(sources.includes(legacy), false, legacy)
  }
  for (const field of ['id', 'name', 'createdAt', 'primaryDeviceId', 'secondaryDeviceId']) {
    assert.equal(sources.includes(field), true, field)
  }
})
