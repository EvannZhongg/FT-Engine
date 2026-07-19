import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('routes the full Stage lifecycle through typed IPC', () => {
  const contract = source('src/shared/ipc-contract.ts')
  const preload = source('src/preload/index.ts')
  const registration = source('src/main/ipc/register-stages.mts')

  const methods = {
    list: 'list',
    create: 'create',
    update: 'update',
    reorder: 'reorder',
    delete: 'delete',
    activate: 'activate',
    complete: 'complete',
    appendFreeContestant: 'append-free-contestant'
  }
  for (const [method, channel] of Object.entries(methods)) {
    assert.equal(contract.includes(`${method}: 'stages:${channel}'`), true, `contract:${method}`)
    assert.equal(preload.includes(`IPC_CHANNELS.stages.${method}`), true, `preload:${method}`)
    assert.equal(registration.includes(`IPC_CHANNELS.stages.${method}`), true, `main:${method}`)
  }
})
