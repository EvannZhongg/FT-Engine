import { app, shell, dialog, ipcMain, globalShortcut } from 'electron'
import { basename, join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'
import { getDataRoot, getPlatformWorkerEnv, getPlatformWorkerLaunchConfig, isMac } from './platform'
import { normalizeExternalUrl } from './security.mjs'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import { WorkerClient } from './worker/worker-client.mjs'
import { DeviceLifecycle } from './match/device-lifecycle.mjs'
import { MatchSessionService } from './match/match-session.mts'
import { CompetitionService } from './application/competitions/competition-service.mts'
import { ExportService, ExportServiceError } from './application/exports/export-service.mts'
import { registerCompetitionIpc } from './ipc/register-competitions.mts'
import { registerExportIpc } from './ipc/register-exports.mts'
import { registerMatchIpc } from './ipc/register-matches.mts'
import { registerQueryIpc } from './ipc/register-queries.mts'
import { registerSettingsIpc } from './ipc/register-settings.mts'
import { registerWindowIpc } from './ipc/register-windows.mts'
import { registerOverlayIpc } from './ipc/register-overlay.mts'
import { registerPlatformIpc } from './ipc/register-platform.mts'
import { registerDeviceIpc } from './ipc/register-devices.mts'
import { LocalDatabase } from './persistence/local-database.mts'
import { DesktopWindowManager } from './app/windows.mts'
import { PlatformWorkerManager } from './infrastructure/platform-worker/platform-worker-manager.mjs'

let localDatabase = null
let platformWorkerManager = null
let windowManager = null

let startupLogStream = null
let startupT0 = 0

function closeStartupLog() {
  if (!startupLogStream) return
  try {
    startupLogStream.end()
  } catch (error) {
    console.error('[Electron] Failed to close startup log:', error)
  } finally {
    startupLogStream = null
  }
}

function initStartupLog() {
  try {
    const logDir = join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }

    const logPath = join(logDir, 'startup.log')
    startupLogStream = fs.createWriteStream(logPath, { flags: 'a' })
    startupT0 = Date.now()
    startupLogStream.write(`\n========== ${new Date().toISOString()} ==========\n`)
    startupLogStream.write(`Log file: ${logPath}\n`)
  } catch (error) {
    console.error('[Electron] Failed to init startup log:', error)
  }
}

function logToFile(message) {
  if (!startupLogStream) return

  try {
    const elapsed = Date.now() - startupT0
    startupLogStream.write(`T+${elapsed}ms    ${message}\n`)
  } catch (error) {
    console.error('[Electron] Failed to write startup log:', error)
  }
}

const deviceLifecycle = new DeviceLifecycle({
  disconnectWorker: async () => {
    if (!platformWorkerManager) return { skipped: true }
    return platformWorkerManager.disconnectAll()
  },
  onStopped: (reason, result) => {
    const message = `Device shutdown (${reason}): worker=${result.worker.status}`
    console.log('[Electron]', message)
    logToFile(message)
  }
})

function sendMatchEvent(channel, payload) {
  windowManager?.sendToAll(channel, payload)
}

const matchSession = new MatchSessionService({
  requestWorker: (method, params = {}, timeoutMs) => {
    if (!platformWorkerManager) throw new Error('WORKER_NOT_RUNNING')
    return platformWorkerManager.request(method, params, timeoutMs)
  },
  persistEvent: (input) => {
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    return localDatabase.appendMatchScoreEvent(input)
  },
  validateContext: (...args) => {
    if (!localDatabase) return false
    return localDatabase.hasMatchContext(...args)
  },
  upsertMediaBinding: (...args) => {
    if (!localDatabase) return false
    return localDatabase.upsertMediaBinding(...args)
  },
  emitRefereeUpdate: (update) => sendMatchEvent(IPC_CHANNELS.match.refereeUpdated, update),
  emitContextUpdate: (context) => sendMatchEvent(IPC_CHANNELS.match.contextUpdated, context),
  emitStatusUpdate: (status) => sendMatchEvent(IPC_CHANNELS.match.statusUpdated, status),
  onError: (code, error) => {
    console.error('[Electron] Match session error:', code, error || '')
    logToFile(`Match session error: ${code}`)
  }
})

platformWorkerManager = new PlatformWorkerManager({
  createClient: createPlatformWorkerClient,
  onEvent: (message) => matchSession.handleWorkerEvent(message),
  onUnavailable: () => matchSession.markWorkerUnavailable(),
  isSessionActive: () => matchSession.isActive(),
  reconnectSession: () => matchSession.reconnectWorker(),
  log: (level, message) => {
    if (level === 'error') console.error('[Electron]', message)
    else if (level === 'warn') console.warn('[Electron]', message)
    else console.log('[Electron]', message)
    logToFile(message)
  }
})

const competitionService = new CompetitionService({
  create: (input) => {
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    return localDatabase.createCompetition(input)
  },
  update: (sourceKey, input) => {
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    return localDatabase.updateCompetition(sourceKey, input)
  },
  get: (sourceKey) => {
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    return localDatabase.getCompetitionConfig(sourceKey)
  },
  list: () => {
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    return localDatabase.listCompetitionProjects()
  },
  delete: (sourceKey) => {
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    return localDatabase.deleteCompetition(sourceKey)
  }
})

const exportService = new ExportService(
  {
    getSnapshot: (sourceKey) => {
      if (!localDatabase) throw new Error('DATABASE_NOT_READY')
      return localDatabase.getCompetitionExportSnapshot(sourceKey)
    }
  },
  {
    write: (outputPath, data) => fs.promises.writeFile(outputPath, data)
  }
)

async function stopDeviceSessions(reason) {
  const transitioned = matchSession.beginStopping()
  const result = await deviceLifecycle.stop(reason)
  if (transitioned) matchSession.completeStop(result.ok)
  return result
}

function openLocalDatabase() {
  const dataRoot = getDataRoot(app)
  const database = new LocalDatabase(join(dataRoot, 'ft-engine.db'), join(dataRoot, 'backups'))
  database.open()
  localDatabase = database
  console.log('[Electron] Local database ready:', database.databasePath)
  logToFile(`Local database ready: ${database.databasePath}`)
}

function closeLocalDatabase() {
  if (!localDatabase) return
  localDatabase.close()
  localDatabase = null
}

function getLocalDataTargets() {
  const dataRoot = getDataRoot(app)
  return [
    join(dataRoot, 'ft-engine.db'),
    join(dataRoot, 'ft-engine.db-shm'),
    join(dataRoot, 'ft-engine.db-wal'),
    join(dataRoot, 'backups'),
    join(dataRoot, 'exports'),
    join(dataRoot, 'logs')
  ]
}

async function deleteLocalDataFiles() {
  await stopDeviceSessions('delete-local-data')
  await platformWorkerManager.stop()
  closeLocalDatabase()
  closeStartupLog()

  const deleted = []
  const failed = []
  for (const target of getLocalDataTargets()) {
    try {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
      }
      deleted.push(target)
    } catch (error) {
      failed.push({ target, message: error.message })
    }
  }

  return { deleted, failed, dataRoot: getDataRoot(app) }
}

function createPlatformWorkerClient() {
  const { cmd, args } = getPlatformWorkerLaunchConfig(is.dev)
  return new WorkerClient({
    command: cmd,
    args,
    cwd: process.cwd(),
    env: getPlatformWorkerEnv(app),
    requestTimeoutMs: 3000
  })
}

function openAllowedExternalUrl(value) {
  const url = normalizeExternalUrl(value)
  if (!url) {
    console.warn('[Electron] Blocked external URL')
    return
  }
  void shell.openExternal(url).catch((error) => {
    console.warn('[Electron] Failed to open external URL:', error.message)
  })
}

windowManager = new DesktopWindowManager({
  app,
  icon,
  isDevelopment: is.dev,
  isMac,
  rendererUrl: process.env['ELECTRON_RENDERER_URL'],
  stopDeviceSessions,
  openExternalUrl: openAllowedExternalUrl,
  checkForUpdates: () => autoUpdater.checkForUpdatesAndNotify()
})

async function saveExportArtifact(buildArtifact) {
  try {
    const artifact = buildArtifact()
    const extensions = artifact.mimeType === 'application/zip' ? ['zip'] : ['csv']
    const options = {
      title: 'Save export',
      defaultPath: join(app.getPath('documents'), artifact.fileName),
      filters: [
        { name: artifact.mimeType === 'application/zip' ? 'ZIP archive' : 'CSV file', extensions }
      ]
    }
    const mainWindow = windowManager.getMainWindow()
    const selection = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (selection.canceled || !selection.filePath) return { status: 'cancelled' }
    await exportService.writeArtifact(artifact, selection.filePath)
    return { status: 'saved', fileName: basename(selection.filePath) }
  } catch (error) {
    const code = error instanceof ExportServiceError ? error.code : 'EXPORT_WRITE_FAILED'
    console.error('[Electron] Export failed:', code, error)
    return { status: 'error', error: code }
  }
}

app.whenReady().then(async () => {
  if (app.isPackaged) {
    initStartupLog()
    logToFile('whenReady done')
  }

  electronApp.setAppUserModelId('com.freakthrow.FT Engine')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    openLocalDatabase()
  } catch (error) {
    console.error('[Electron] Local database unavailable:', error.message)
    logToFile(`Local database unavailable: ${error.message}`)
  }
  try {
    await platformWorkerManager.start()
  } catch (error) {
    console.error('[Electron] Platform Worker unavailable:', error.message)
    logToFile(`Platform Worker unavailable: ${error.message}`)
    platformWorkerManager.scheduleRestart()
  }

  logToFile('Creating main window...')
  windowManager.createMainWindow()
  logToFile('Main window created')

  autoUpdater.on('update-available', () => {
    windowManager.sendToMain(IPC_CHANNELS.app.updateAvailable)
  })

  autoUpdater.on('update-downloaded', () => {
    windowManager.sendToMain(IPC_CHANNELS.app.updateDownloaded)
  })

  ipcMain.on(IPC_CHANNELS.app.restartForUpdate, async (event) => {
    if (
      windowManager.rejectUnexpectedSender(
        event,
        windowManager.getMainWindow(),
        IPC_CHANNELS.app.restartForUpdate
      )
    ) {
      return
    }
    await stopDeviceSessions('restart-for-update')
    await platformWorkerManager.stop()
    closeLocalDatabase()
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle(IPC_CHANNELS.shortcuts.register, (event, shortcut) => {
    windowManager.assertMainSender(event)
    globalShortcut.unregisterAll()

    if (typeof shortcut !== 'string' || shortcut.length < 1 || shortcut.length > 64) {
      return { ok: false, error: 'SHORTCUT_INVALID' }
    }

    try {
      const registered = globalShortcut.register(shortcut, () => {
        console.log('[Electron] Global shortcut triggered:', shortcut)
        windowManager.sendToMain(IPC_CHANNELS.shortcuts.triggered)
      })

      if (!registered) {
        console.log('[Electron] Global shortcut registration failed')
        return { ok: false, error: 'SHORTCUT_UNAVAILABLE' }
      }
      return { ok: true }
    } catch (error) {
      console.error('[Electron] Error registering shortcut:', error)
      return { ok: false, error: 'SHORTCUT_INVALID' }
    }
  })

  ipcMain.on(IPC_CHANNELS.shortcuts.unregister, (event) => {
    if (
      windowManager.rejectUnexpectedSender(
        event,
        windowManager.getMainWindow(),
        IPC_CHANNELS.shortcuts.unregister
      )
    ) {
      return
    }
    globalShortcut.unregisterAll()
    console.log('[Electron] Global shortcuts unregistered')
  })

  const ipcContext = {
    assertMainSender: (event) => windowManager.assertMainSender(event),
    getDatabase: () => localDatabase
  }
  registerSettingsIpc(ipcContext)
  registerCompetitionIpc(ipcContext, competitionService)
  registerMatchIpc(ipcContext, competitionService, matchSession, stopDeviceSessions)
  registerQueryIpc(ipcContext)
  registerExportIpc(ipcContext, exportService, saveExportArtifact)
  registerWindowIpc(windowManager)
  registerOverlayIpc(windowManager, () => matchSession.getStatus())
  registerPlatformIpc(ipcContext, platformWorkerManager)
  registerDeviceIpc(ipcContext, platformWorkerManager)

  ipcMain.handle(IPC_CHANNELS.app.deleteLocalData, async (event) => {
    windowManager.assertMainSender(event)
    const result = await deleteLocalDataFiles()
    if (result.failed.length > 0) {
      return { ok: false, ...result }
    }

    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 150)

    return { ok: true, ...result }
  })

  app.on('activate', function () {
    if (!windowManager.getMainWindow()) windowManager.createMainWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  closeLocalDatabase()
  platformWorkerManager.terminate()
})

app.on('window-all-closed', async () => {
  if (!isMac) {
    await platformWorkerManager.stop()
    closeLocalDatabase()
    app.quit()
  }
})
