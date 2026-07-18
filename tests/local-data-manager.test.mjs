import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LocalDataManager } from '../src/main/persistence/local-data-manager.mts'

function temporaryRoot() {
  return mkdtempSync(path.join(os.tmpdir(), 'ft-engine-local-data-'))
}

test('owns one local database lifecycle', () => {
  const root = temporaryRoot()
  const localData = new LocalDataManager(root)
  try {
    assert.throws(() => localData.requireDatabase(), /DATABASE_NOT_READY/)
    const first = localData.openDatabase()
    assert.equal(localData.openDatabase(), first)
    assert.equal(localData.getDatabase(), first)
    assert.throws(() => localData.deleteFiles(), /DATABASE_STILL_OPEN/)
    localData.closeDatabase()
    assert.equal(localData.getDatabase(), null)
  } finally {
    localData.closeDatabase()
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects unsafe local data roots', () => {
  assert.throws(() => new LocalDataManager(''), /LOCAL_DATA_ROOT_INVALID/)
  assert.throws(
    () => new LocalDataManager(path.parse(path.resolve(os.tmpdir())).root),
    /LOCAL_DATA_ROOT_INVALID/
  )
})

test('deletes only bounded FT Engine local data targets', () => {
  const root = temporaryRoot()
  const localData = new LocalDataManager(root)
  try {
    for (const target of localData.dataTargets()) {
      if (path.extname(target)) {
        writeFileSync(target, 'data')
      } else {
        mkdirSync(target, { recursive: true })
        writeFileSync(path.join(target, 'entry'), 'data')
      }
    }

    const result = localData.deleteFiles()
    assert.deepEqual(result.failed, [])
    assert.deepEqual(result.deleted, localData.dataTargets())
    assert.equal(result.dataRoot, root)
    assert.equal(result.deleted.every((target) => !existsSync(target)), true)
    assert.equal(existsSync(root), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
