import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('keeps domain IPC registration out of the Main composition root', () => {
  const main = source('src/main/index.js')
  for (const domain of ['settings', 'match', 'replay', 'reports', 'projects', 'exports']) {
    assert.equal(main.includes(`ipcMain.handle(IPC_CHANNELS.${domain}`), false, domain)
  }
  for (const registration of [
    'registerSettingsIpc',
    'registerCompetitionIpc',
    'registerMatchIpc',
    'registerQueryIpc',
    'registerExportIpc'
  ]) {
    assert.equal(main.includes(`${registration}(`), true, registration)
  }
})
