import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('keeps the Electron entrypoint limited to bootstrap', () => {
  const main = source('src/main/index.js')
  assert.equal(main.includes('bootstrapDesktopApp({ icon })'), true)
  for (const implementation of [
    "from 'electron'",
    'new LocalDatabase',
    'new DesktopWindowManager',
    'registerMatchIpc(',
    'showSaveDialog',
    'rmSync',
    'createWriteStream'
  ]) {
    assert.equal(main.includes(implementation), false, implementation)
  }
})

test('registers domain IPC from the Main bootstrap', () => {
  const bootstrap = source('src/main/app/bootstrap.mts')
  for (const domain of ['settings', 'match', 'replay', 'reports', 'projects', 'exports']) {
    assert.equal(bootstrap.includes(`ipcMain.handle(IPC_CHANNELS.${domain}`), false, domain)
  }
  for (const registration of [
    'registerSettingsIpc',
    'registerCompetitionIpc',
    'registerStageIpc',
    'registerMatchIpc',
    'registerQueryIpc',
    'registerExportIpc'
  ]) {
    assert.equal(bootstrap.includes(`${registration}(`), true, registration)
  }
})

test('keeps SQLite schema and connection lifecycle outside the repository facade', () => {
  const facade = source('src/main/persistence/local-database.mts')
  const connection = source('src/main/persistence/sqlite/connection.mts')
  const schema = source('src/main/persistence/sqlite/schema.mts')
  for (const implementation of ['CREATE TABLE', 'copyFileSync', 'new DatabaseSync']) {
    assert.equal(facade.includes(implementation), false, implementation)
  }
  assert.equal(connection.includes('new DatabaseSync'), true)
  assert.equal(connection.includes('createResetBackup'), true)
  assert.equal(schema.includes('CREATE TABLE competitions'), true)
})

test('delegates settings persistence to its repository', () => {
  const facade = source('src/main/persistence/local-database.mts')
  const repository = source('src/main/persistence/repositories/settings-repository.mts')
  assert.equal(facade.includes('FROM app_settings'), false)
  assert.equal(facade.includes('new SettingsRepository'), true)
  assert.equal(repository.includes('FROM app_settings'), true)
  assert.equal(repository.includes('SETTINGS_KEY_INVALID'), true)
})

test('keeps domain SQL in repositories and read queries', () => {
  const facade = source('src/main/persistence/local-database.mts')
  const competition = source('src/main/persistence/repositories/competition-repository.mts')
  const match = source('src/main/persistence/repositories/match-repository.mts')
  const replay = source('src/main/persistence/queries/replay-query.mts')
  const report = source('src/main/persistence/queries/report-query.mts')
  const exportQuery = source('src/main/persistence/queries/export-query.mts')

  assert.equal(facade.includes('.prepare('), false)
  for (const collaborator of [
    'CompetitionRepository',
    'MatchRepository',
    'ReplayQuery',
    'ReportQuery',
    'ExportQuery'
  ]) {
    assert.equal(facade.includes(`new ${collaborator}`), true, collaborator)
  }
  assert.equal(competition.includes('INSERT INTO competitions'), true)
  assert.equal(match.includes('INSERT OR IGNORE INTO score_events'), true)
  assert.equal(replay.includes('delta_penalty'), true)
  assert.equal(report.includes('ROW_NUMBER() OVER'), true)
  assert.equal(exportQuery.includes("database.exec('BEGIN')"), true)
})

test('keeps window and Overlay lifecycle out of the Main composition root', () => {
  const bootstrap = source('src/main/app/bootstrap.mts')
  const windows = source('src/main/app/windows.mts')
  const windowIpc = source('src/main/ipc/register-windows.mts')
  const overlayIpc = source('src/main/ipc/register-overlay.mts')

  for (const implementation of [
    'new BrowserWindow',
    'screen.getPrimaryDisplay',
    'ipcMain.on(IPC_CHANNELS.window',
    'ipcMain.on(IPC_CHANNELS.overlay'
  ]) {
    assert.equal(bootstrap.includes(implementation), false, implementation)
  }
  assert.equal(bootstrap.includes('new DesktopWindowManager'), true)
  assert.equal(bootstrap.includes('registerWindowIpc(windows)'), true)
  assert.equal(bootstrap.includes('registerOverlayIpc(windows'), true)
  assert.equal(windows.includes('new BrowserWindow'), true)
  assert.equal(windows.includes('calculateMainWindowLayout'), true)
  assert.equal(windowIpc.includes('IPC_CHANNELS.window.toggleMaximize'), true)
  assert.equal(overlayIpc.includes('IPC_CHANNELS.overlay.setClickThrough'), true)
})

test('keeps Platform Worker lifecycle and device IPC out of the Main composition root', () => {
  const bootstrap = source('src/main/app/bootstrap.mts')
  const manager = source('src/main/infrastructure/platform-worker/platform-worker-manager.mjs')
  const platformIpc = source('src/main/ipc/register-platform.mts')
  const deviceIpc = source('src/main/ipc/register-devices.mts')

  for (const implementation of [
    'platformWorkerRestartTimer',
    "worker.on('exit'",
    'ipcMain.handle(IPC_CHANNELS.platform',
    'ipcMain.handle(IPC_CHANNELS.devices'
  ]) {
    assert.equal(bootstrap.includes(implementation), false, implementation)
  }
  assert.equal(bootstrap.includes('new PlatformWorkerManager'), true)
  assert.equal(bootstrap.includes('registerPlatformIpc(ipcContext, workerManager)'), true)
  assert.equal(bootstrap.includes('registerDeviceIpc(ipcContext, workerManager)'), true)
  assert.equal(manager.includes("worker.on('exit'"), true)
  assert.equal(manager.includes('this.#maxRestarts'), true)
  assert.equal(platformIpc.includes('IPC_INVALID_WINDOW_ID'), true)
  assert.equal(deviceIpc.includes('IPC_INVALID_DEVICE_REMARKS'), true)
})

test('keeps application lifecycle and command IPC out of the Main composition root', () => {
  const bootstrap = source('src/main/app/bootstrap.mts')
  const lifecycle = source('src/main/app/lifecycle.mts')
  const updates = source('src/main/app/updates.mts')
  const appIpc = source('src/main/ipc/register-app.mts')
  const shortcutIpc = source('src/main/ipc/register-shortcuts.mts')

  for (const implementation of [
    "app.on('activate'",
    "app.on('will-quit'",
    "app.on('window-all-closed'",
    'ipcMain.on(IPC_CHANNELS.app',
    'ipcMain.handle(IPC_CHANNELS.shortcuts'
  ]) {
    assert.equal(bootstrap.includes(implementation), false, implementation)
  }
  assert.equal(bootstrap.includes('registerAppLifecycle(app'), true)
  assert.equal(bootstrap.includes('registerUpdateNotifications(autoUpdater, windows)'), true)
  assert.equal(bootstrap.includes('registerAppIpc(windows'), true)
  assert.equal(bootstrap.includes('registerShortcutIpc(windows, globalShortcut)'), true)
  assert.equal(lifecycle.includes("app.on('will-quit'"), true)
  assert.equal(updates.includes('IPC_CHANNELS.app.updateDownloaded'), true)
  assert.equal(appIpc.includes('IPC_CHANNELS.app.deleteLocalData'), true)
  assert.equal(shortcutIpc.includes('IPC_CHANNELS.shortcuts.register'), true)
})

test('keeps local file and export dialog implementation out of bootstrap', () => {
  const bootstrap = source('src/main/app/bootstrap.mts')
  const localData = source('src/main/persistence/local-data-manager.mts')
  const startupLog = source('src/main/infrastructure/filesystem/startup-log.mts')
  const exportSaver = source('src/main/infrastructure/filesystem/export-artifact-saver.mts')

  for (const implementation of ['rmSync(', 'createWriteStream(', '.showSaveDialog(']) {
    assert.equal(bootstrap.includes(implementation), false, implementation)
  }
  assert.equal(localData.includes('rmSync('), true)
  assert.equal(startupLog.includes('createWriteStream('), true)
  assert.equal(exportSaver.includes('.showSaveDialog('), true)
  assert.equal(exportSaver.includes('EXPORT_WRITE_FAILED'), true)
})
