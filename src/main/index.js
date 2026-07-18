import { app, shell, BrowserWindow, dialog, ipcMain, screen, globalShortcut } from 'electron'
import { basename, join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'
import { getDataRoot, getPlatformWorkerEnv, getPlatformWorkerLaunchConfig, isMac } from './platform'
import { normalizeExternalUrl, normalizeOverlayOptions } from './security.mjs'
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
import { LocalDatabase } from './persistence/local-database.mts'

let platformWorker = null
let localDatabase = null
let platformWorkerRestartTimer = null
let platformWorkerRestartCount = 0
let platformWorkerStopping = false
let mainWindow = null
let overlayWindow = null
let mainWindowCloseInProgress = false
const MAIN_WINDOW_TITLE = 'FT Engine'
const OVERLAY_WINDOW_TITLE = 'FT Engine Overlay'
const MAX_PLATFORM_WORKER_RESTARTS = 3

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
    if (!platformWorker) return { skipped: true }
    await platformWorker.request('device.disconnectAll', {}, 5000)
  },
  onStopped: (reason, result) => {
    const message = `Device shutdown (${reason}): worker=${result.worker.status}`
    console.log('[Electron]', message)
    logToFile(message)
  }
})

function sendMatchEvent(channel, payload) {
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

const matchSession = new MatchSessionService({
  requestWorker: (method, params = {}, timeoutMs) => {
    if (!platformWorker) throw new Error('WORKER_NOT_RUNNING')
    return platformWorker.request(method, params, timeoutMs)
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
  await exitPlatformWorker()
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

async function createPlatformWorker() {
  const { cmd, args } = getPlatformWorkerLaunchConfig(is.dev)
  const worker = new WorkerClient({
    command: cmd,
    args,
    cwd: process.cwd(),
    env: getPlatformWorkerEnv(app),
    requestTimeoutMs: 3000
  })
  platformWorker = worker
  worker.on('stderr', (chunk) => {
    const message = chunk.trim()
    if (message) console.warn('[Platform Worker]', message)
  })
  worker.on('protocolError', (error) => {
    console.error('[Electron] Platform Worker protocol error:', error.code)
  })
  worker.on('event', (message) => matchSession.handleWorkerEvent(message))
  worker.on('exit', ({ code, signal }) => {
    console.warn(`[Electron] Platform Worker exited (code=${code}, signal=${signal})`)
    if (platformWorker === worker) platformWorker = null
    if (!platformWorkerStopping) matchSession.markWorkerUnavailable()
    schedulePlatformWorkerRestart()
  })

  try {
    await worker.start()
    const hello = await worker.request('system.hello')
    console.log('[Electron] Platform Worker ready:', hello)
    logToFile(`Platform Worker ready: ${JSON.stringify(hello)}`)
    if (matchSession.isActive()) await matchSession.reconnectWorker()
    return hello
  } catch (error) {
    worker.terminate()
    if (platformWorker === worker) platformWorker = null
    throw error
  }
}

function schedulePlatformWorkerRestart() {
  if (
    platformWorkerStopping ||
    platformWorkerRestartTimer ||
    platformWorkerRestartCount >= MAX_PLATFORM_WORKER_RESTARTS
  ) {
    return
  }
  platformWorkerRestartCount += 1
  const delayMs = platformWorkerRestartCount * 1000
  console.warn(
    `[Electron] Restarting Platform Worker in ${delayMs}ms ` +
      `(${platformWorkerRestartCount}/${MAX_PLATFORM_WORKER_RESTARTS})`
  )
  platformWorkerRestartTimer = setTimeout(async () => {
    platformWorkerRestartTimer = null
    try {
      await createPlatformWorker()
    } catch (error) {
      console.error('[Electron] Platform Worker restart failed:', error.message)
      schedulePlatformWorkerRestart()
    }
  }, delayMs)
}

async function exitPlatformWorker() {
  platformWorkerStopping = true
  if (platformWorkerRestartTimer) {
    clearTimeout(platformWorkerRestartTimer)
    platformWorkerRestartTimer = null
  }
  const worker = platformWorker
  platformWorker = null
  if (worker) await worker.stop(750)
}

function isSender(event, window) {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents)
}

function assertMainSender(event) {
  if (!isSender(event, mainWindow)) {
    throw new Error('IPC_UNAUTHORIZED')
  }
}

function rejectUnexpectedSender(event, window, channel) {
  if (isSender(event, window)) return false
  console.warn(`[Electron] Blocked unauthorized IPC: ${channel}`)
  return true
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
    const selection =
      mainWindow && !mainWindow.isDestroyed()
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

function createWindow() {
  mainWindowCloseInProgress = false
  mainWindow = new BrowserWindow({
    title: MAIN_WINDOW_TITLE,
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    transparent: false,
    backgroundColor: '#1e1e1e',
    hasShadow: true,
    resizable: true,
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (!is.dev) {
      autoUpdater.checkForUpdatesAndNotify()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openAllowedExternalUrl(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openAllowedExternalUrl(url)
  })

  mainWindow.on('close', (event) => {
    if (mainWindowCloseInProgress) return
    event.preventDefault()
    mainWindowCloseInProgress = true
    const closingWindow = mainWindow
    void stopDeviceSessions('window-close').finally(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
      overlayWindow = null
      if (closingWindow && !closingWindow.isDestroyed()) closingWindow.destroy()
      if (isMac) app.quit()
    })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  platformWorkerStopping = false
  try {
    await createPlatformWorker()
  } catch (error) {
    console.error('[Electron] Platform Worker unavailable:', error.message)
    logToFile(`Platform Worker unavailable: ${error.message}`)
    schedulePlatformWorkerRestart()
  }

  logToFile('Creating main window...')
  createWindow()
  logToFile('Main window created')

  autoUpdater.on('update-available', () => {
    if (mainWindow) mainWindow.webContents.send(IPC_CHANNELS.app.updateAvailable)
  })

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send(IPC_CHANNELS.app.updateDownloaded)
  })

  ipcMain.on(IPC_CHANNELS.app.restartForUpdate, async (event) => {
    if (rejectUnexpectedSender(event, mainWindow, IPC_CHANNELS.app.restartForUpdate)) return
    await stopDeviceSessions('restart-for-update')
    await exitPlatformWorker()
    closeLocalDatabase()
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle(IPC_CHANNELS.shortcuts.register, (event, shortcut) => {
    assertMainSender(event)
    globalShortcut.unregisterAll()

    if (typeof shortcut !== 'string' || shortcut.length < 1 || shortcut.length > 64) {
      return { ok: false, error: 'SHORTCUT_INVALID' }
    }

    try {
      const registered = globalShortcut.register(shortcut, () => {
        console.log('[Electron] Global shortcut triggered:', shortcut)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.shortcuts.triggered)
        }
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
    if (rejectUnexpectedSender(event, mainWindow, IPC_CHANNELS.shortcuts.unregister)) return
    globalShortcut.unregisterAll()
    console.log('[Electron] Global shortcuts unregistered')
  })

  ipcMain.handle(IPC_CHANNELS.platform.listWindows, async (event) => {
    assertMainSender(event)
    if (!platformWorker) throw new Error('WORKER_NOT_RUNNING')
    return platformWorker.request('window.list')
  })

  ipcMain.handle(IPC_CHANNELS.platform.getWindowBounds, async (event, windowId) => {
    assertMainSender(event)
    if (typeof windowId !== 'string' || !windowId || windowId.length > 128) {
      throw new Error('IPC_INVALID_WINDOW_ID')
    }
    if (!platformWorker) throw new Error('WORKER_NOT_RUNNING')
    return platformWorker.request('window.getBounds', { windowId })
  })

  ipcMain.handle(IPC_CHANNELS.devices.scan, async (event, value) => {
    assertMainSender(event)
    const options = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const flush = options.flush === true
    const rawRemarks =
      options.remarks && typeof options.remarks === 'object' && !Array.isArray(options.remarks)
        ? options.remarks
        : {}
    const entries = Object.entries(rawRemarks)
    if (entries.length > 1000) throw new Error('IPC_INVALID_DEVICE_REMARKS')
    const remarks = {}
    for (const [deviceId, remark] of entries) {
      if (deviceId.length > 256 || typeof remark !== 'string' || remark.length > 256) {
        throw new Error('IPC_INVALID_DEVICE_REMARKS')
      }
      remarks[deviceId] = remark
    }
    if (!platformWorker) throw new Error('WORKER_NOT_RUNNING')
    return platformWorker.request('device.scan', { flush, remarks }, flush ? 8000 : 5000)
  })

  ipcMain.handle(IPC_CHANNELS.devices.rename, async (event, value) => {
    assertMainSender(event)
    if (!Array.isArray(value) || value.length > 100) {
      throw new Error('IPC_INVALID_DEVICE_RENAME')
    }
    if (!platformWorker) throw new Error('WORKER_NOT_RUNNING')
    return Promise.all(
      value.map(async (item) => {
        if (
          !item ||
          typeof item.deviceId !== 'string' ||
          !item.deviceId ||
          item.deviceId.length > 128 ||
          typeof item.name !== 'string' ||
          !item.name.trim() ||
          Buffer.byteLength(item.name.trim(), 'utf8') > 32
        ) {
          return {
            deviceId: String(item?.deviceId || ''),
            name: String(item?.name || ''),
            status: 'error',
            error: 'INVALID_PARAMS'
          }
        }
        try {
          await platformWorker.request(
            'device.renameDiscovered',
            {
              deviceId: item.deviceId,
              name: item.name.trim()
            },
            15000
          )
          return { deviceId: item.deviceId, name: item.name.trim(), status: 'ok' }
        } catch (error) {
          return {
            deviceId: item.deviceId,
            name: item.name.trim(),
            status: 'error',
            error: error.code || 'DEVICE_RENAME_FAILED'
          }
        }
      })
    )
  })

  const ipcContext = {
    assertMainSender,
    getDatabase: () => localDatabase
  }
  registerSettingsIpc(ipcContext)
  registerCompetitionIpc(ipcContext, competitionService)
  registerMatchIpc(ipcContext, competitionService, matchSession, stopDeviceSessions)
  registerQueryIpc(ipcContext)
  registerExportIpc(ipcContext, exportService, saveExportArtifact)

  ipcMain.handle(IPC_CHANNELS.app.deleteLocalData, async (event) => {
    assertMainSender(event)
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

  ipcMain.on(IPC_CHANNELS.window.setContentProtection, (event, enabled) => {
    if (rejectUnexpectedSender(event, mainWindow, IPC_CHANNELS.window.setContentProtection)) return
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setContentProtection(!!enabled)
    }
  })

  ipcMain.on(IPC_CHANNELS.window.toggleMaximize, (event) => {
    if (rejectUnexpectedSender(event, mainWindow, IPC_CHANNELS.window.toggleMaximize)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.on(IPC_CHANNELS.overlay.ready, (event) => {
    if (rejectUnexpectedSender(event, overlayWindow, IPC_CHANNELS.overlay.ready)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && win.initialOverlayData) {
      win.webContents.send(IPC_CHANNELS.overlay.initialData, win.initialOverlayData)
    }
    if (win) {
      win.webContents.send(IPC_CHANNELS.match.statusUpdated, matchSession.getStatus())
    }
  })

  ipcMain.on(IPC_CHANNELS.overlay.open, (event, value) => {
    if (rejectUnexpectedSender(event, mainWindow, IPC_CHANNELS.overlay.open)) return
    let bounds
    let initialState
    try {
      ;({ bounds, initialState } = normalizeOverlayOptions(value))
    } catch (error) {
      console.warn('[Electron] Rejected overlay options:', error.message)
      return
    }
    if (overlayWindow) {
      overlayWindow.focus()
      return
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    let winX = 0
    let winY = 0
    let winW = primaryDisplay.workAreaSize.width
    let winH = primaryDisplay.workAreaSize.height

    if (bounds) {
      if (bounds.x < -10000 || bounds.y < -10000) {
        console.log(
          '[Electron] Detected minimized/off-screen target, resetting overlay to primary display.'
        )
      } else {
        winX = Math.round(bounds.x)
        winY = Math.round(bounds.y)
        winW = Math.round(bounds.width)
        winH = Math.round(bounds.height)
      }
    }

    overlayWindow = new BrowserWindow({
      title: OVERLAY_WINDOW_TITLE,
      width: winW,
      height: winH,
      x: winX,
      y: winY,
      transparent: true,
      frame: false,
      hasShadow: false,
      fullscreen: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
    overlayWindow.setContentProtection(false)
    overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    overlayWindow.webContents.on('will-navigate', (event) => event.preventDefault())

    if (initialState) {
      overlayWindow.initialOverlayData = initialState
    }

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?mode=overlay`)
    } else {
      overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: 'mode=overlay' })
    }

    overlayWindow.setIgnoreMouseEvents(true, { forward: true })

    overlayWindow.webContents.on('did-finish-load', () => {
      if (initialState) {
        overlayWindow.webContents.send(IPC_CHANNELS.overlay.initialData, initialState)
      }
    })

    overlayWindow.on('closed', () => {
      overlayWindow = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('overlay-closed')
      }
    })
  })

  ipcMain.on(IPC_CHANNELS.overlay.close, (event) => {
    if (!isSender(event, mainWindow) && !isSender(event, overlayWindow)) {
      console.warn('[Electron] Blocked unauthorized IPC: overlay:close')
      return
    }
    if (overlayWindow) {
      overlayWindow.close()
    }
  })

  ipcMain.on(IPC_CHANNELS.overlay.setClickThrough, (event, ignore) => {
    if (rejectUnexpectedSender(event, overlayWindow, IPC_CHANNELS.overlay.setClickThrough)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (ignore) {
        win.setIgnoreMouseEvents(true, { forward: true })
      } else {
        win.setIgnoreMouseEvents(false)
        win.setAlwaysOnTop(true, 'screen-saver')
      }
    }
  })

  ipcMain.on(IPC_CHANNELS.window.minimize, (event) => {
    if (rejectUnexpectedSender(event, mainWindow, IPC_CHANNELS.window.minimize)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.minimize()
  })

  ipcMain.on(IPC_CHANNELS.window.close, (event) => {
    if (rejectUnexpectedSender(event, mainWindow, IPC_CHANNELS.window.close)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.close()
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  closeLocalDatabase()
  platformWorkerStopping = true
  if (platformWorkerRestartTimer) {
    clearTimeout(platformWorkerRestartTimer)
    platformWorkerRestartTimer = null
  }
  if (platformWorker) {
    platformWorker.terminate()
    platformWorker = null
  }
})

app.on('window-all-closed', async () => {
  if (!isMac) {
    await exitPlatformWorker()
    closeLocalDatabase()
    app.quit()
  }
})
