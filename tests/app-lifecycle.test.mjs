import assert from 'node:assert/strict'
import test from 'node:test'

import { registerAppLifecycle } from '../src/main/app/lifecycle.mts'
import { registerUpdateNotifications } from '../src/main/app/updates.mts'

class FakeApp {
  listeners = new Map()
  quitCount = 0

  on(event, listener) {
    this.listeners.set(event, listener)
  }

  trigger(event) {
    return this.listeners.get(event)?.()
  }

  quit() {
    this.quitCount += 1
  }
}

function createLifecycleFixture(isMac = false) {
  const app = new FakeApp()
  const calls = []
  let hasMainWindow = false
  registerAppLifecycle(app, {
    isMac,
    hasMainWindow: () => hasMainWindow,
    createMainWindow: () => calls.push('create-window'),
    unregisterShortcuts: () => calls.push('unregister-shortcuts'),
    closeDatabase: () => calls.push('close-database'),
    terminateWorker: () => calls.push('terminate-worker'),
    stopWorker: async () => calls.push('stop-worker')
  })
  return {
    app,
    calls,
    setMainWindow(value) {
      hasMainWindow = value
    }
  }
}

test('recreates the main window on activation only when needed', () => {
  const fixture = createLifecycleFixture()
  fixture.app.trigger('activate')
  fixture.setMainWindow(true)
  fixture.app.trigger('activate')
  assert.deepEqual(fixture.calls, ['create-window'])
})

test('cleans up process-wide resources before quitting', () => {
  const fixture = createLifecycleFixture()
  fixture.app.trigger('will-quit')
  assert.deepEqual(fixture.calls, ['unregister-shortcuts', 'close-database', 'terminate-worker'])
})

test('stops the worker before closing the database on non-macOS', async () => {
  const fixture = createLifecycleFixture()
  await fixture.app.trigger('window-all-closed')
  assert.deepEqual(fixture.calls, ['stop-worker', 'close-database'])
  assert.equal(fixture.app.quitCount, 1)
})

test('keeps the process alive after all windows close on macOS', async () => {
  const fixture = createLifecycleFixture(true)
  await fixture.app.trigger('window-all-closed')
  assert.deepEqual(fixture.calls, [])
  assert.equal(fixture.app.quitCount, 0)
})

test('forwards updater lifecycle events to the main window', () => {
  const listeners = new Map()
  const channels = []
  registerUpdateNotifications(
    { on: (event, listener) => listeners.set(event, listener) },
    { sendToMain: (channel) => channels.push(channel) }
  )

  listeners.get('update-available')()
  listeners.get('update-downloaded')()
  assert.deepEqual(channels, ['app:update-available', 'app:update-downloaded'])
})
