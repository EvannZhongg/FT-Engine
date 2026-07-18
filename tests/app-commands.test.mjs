import assert from 'node:assert/strict'
import test from 'node:test'

import { DesktopAppCommands } from '../src/main/app/desktop-app-commands.mts'

function createFixture() {
  const calls = []
  const deleted = { deleted: ['ft-engine.db'], failed: [], dataRoot: 'data-root' }
  const commands = new DesktopAppCommands({
    stopDeviceSessions: async (reason) => calls.push(`stop-devices:${reason}`),
    stopWorker: async () => calls.push('stop-worker'),
    closeDatabase: () => calls.push('close-database'),
    closeLog: async () => calls.push('close-log'),
    deleteLocalDataFiles: () => {
      calls.push('delete-files')
      return deleted
    },
    quitAndInstall: () => calls.push('quit-and-install'),
    relaunchProcess: () => calls.push('relaunch'),
    exitProcess: (code) => calls.push(`exit:${code}`)
  })
  return { calls, commands, deleted }
}

test('stops owners and closes files before deleting local data', async () => {
  const fixture = createFixture()
  assert.equal(await fixture.commands.deleteLocalData(), fixture.deleted)
  assert.deepEqual(fixture.calls, [
    'stop-devices:delete-local-data',
    'stop-worker',
    'close-database',
    'close-log',
    'delete-files'
  ])
})

test('shuts down local owners before installing an update', async () => {
  const fixture = createFixture()
  await fixture.commands.restartForUpdate()
  assert.deepEqual(fixture.calls, [
    'stop-devices:restart-for-update',
    'stop-worker',
    'close-database',
    'close-log',
    'quit-and-install'
  ])
})

test('relaunches before exiting the current process', () => {
  const fixture = createFixture()
  fixture.commands.relaunch()
  assert.deepEqual(fixture.calls, ['relaunch', 'exit:0'])
})
