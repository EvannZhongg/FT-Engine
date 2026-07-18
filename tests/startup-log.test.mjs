import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { StartupLog } from '../src/main/infrastructure/filesystem/startup-log.mts'

test('writes and closes a bounded startup log', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ft-engine-startup-log-'))
  let elapsed = 1000
  const errors = []
  const log = new StartupLog(root, {
    now: () => new Date('2026-07-19T00:00:00.000Z'),
    elapsedNow: () => elapsed,
    reportError: (...args) => errors.push(args)
  })
  try {
    log.init()
    elapsed = 1042
    log.write('Main window created')
    await log.close()

    const content = readFileSync(path.join(root, 'logs', 'startup.log'), 'utf8')
    assert.match(content, /2026-07-19T00:00:00\.000Z/)
    assert.match(content, /T\+42ms {4}Main window created/)
    assert.deepEqual(errors, [])
  } finally {
    await log.close()
    rmSync(root, { recursive: true, force: true })
  }
})
