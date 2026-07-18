import { app, shell, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import yaml from 'js-yaml'
import fs from 'fs'
import {
  getBackendEnv,
  getBackendLaunchConfig,
  getConfigPath,
  getDataRoot,
  getPlatformWorkerLaunchConfig,
  isMac,
  isWindows
} from './platform'
import { normalizeExternalUrl, normalizeOverlayOptions } from './security.mjs'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import { WorkerClient } from './worker/worker-client.mjs'
import { DeviceLifecycle } from './match/device-lifecycle.mjs'
import { MatchSessionService } from './match/match-session.mts'
import { LocalDatabase } from './persistence/local-database.mts'
import {
  deleteLegacyProjectSource,
  importLegacyProject,
  importLegacyProjects
} from './persistence/legacy-importer.mts'
import { parseLegacyShadowEventLine } from './legacy/shadow-event.mts'

const { spawn, execSync } = require('child_process')
const net = require('net')

let pyProc = null
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
let backendStdoutBuffer = ''

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

function getAppConfig() {
  let port = 8000

  try {
    const configPath = getConfigPath(app)
    console.log('[Electron] Config Path:', configPath)

    if (fs.existsSync(configPath)) {
      const fileContents = fs.readFileSync(configPath, 'utf8')
      const config = yaml.load(fileContents)
      if (config && config.server_port) {
        port = config.server_port
        console.log(`[Electron] Loaded port from config: ${port}`)
      }
    } else {
      console.log('[Electron] Config file not found, using default port 8000')
    }
  } catch (error) {
    console.error('[Electron] Failed to load config:', error)
  }

  return { port }
}

const appConfig = getAppConfig()

async function disconnectLegacyDevices() {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${appConfig.port}/teardown`, {
        method: 'POST',
        signal: AbortSignal.timeout(2500)
      })
      const result = await response.json()
      if (!response.ok || result?.status !== 'ok') throw new Error('Legacy teardown rejected')
      return
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  const error = new Error(lastError?.message || 'Legacy teardown failed')
  error.code = 'LEGACY_TEARDOWN_FAILED'
  throw error
}

const deviceLifecycle = new DeviceLifecycle({
  disconnectWorker: async () => {
    if (!platformWorker) return { skipped: true }
    await platformWorker.request('device.disconnectAll', {}, 5000)
  },
  disconnectLegacy: disconnectLegacyDevices,
  onStopped: (reason, result) => {
    const message = `Device shutdown (${reason}): worker=${result.worker.status}, legacy=${result.legacy.status}`
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
    return localDatabase.appendLegacyScoreEvent(input)
  },
  upsertMediaBinding: (...args) => {
    if (!localDatabase) return false
    return localDatabase.upsertLegacyMediaBinding(...args)
  },
  emitRefereeUpdate: (update) => sendMatchEvent(IPC_CHANNELS.match.refereeUpdated, update),
  emitContextUpdate: (context) => sendMatchEvent(IPC_CHANNELS.match.contextUpdated, context),
  emitStatusUpdate: (status) => sendMatchEvent(IPC_CHANNELS.match.statusUpdated, status),
  onError: (code, error) => {
    console.error('[Electron] Match session error:', code, error || '')
    logToFile(`Match session error: ${code}`)
  }
})

async function stopDeviceSessions(reason) {
  const transitioned = matchSession.beginStopping()
  const result = await deviceLifecycle.stop(reason)
  if (transitioned) matchSession.completeStop(result.ok)
  return result
}

const createPyProc = () => {
  const { cmd, args } = getBackendLaunchConfig(__dirname, is.dev)
  console.log(`[Electron] Starting Python backend (${is.dev ? 'Dev' : 'Prod'}):`, cmd, args)
  pyProc = spawn(cmd, args, { env: getBackendEnv(app) })

  if (pyProc != null) {
    backendStdoutBuffer = ''
    console.log('[Electron] Python process started, PID:', pyProc.pid)
    logToFile('Backend process spawned, PID: ' + pyProc.pid)
    pyProc.stdout.on('data', function (data) {
      processBackendStdout(data.toString())
    })
    pyProc.stderr.on('data', function (data) {
      const line = data.toString()
      console.log('py_stderr: ' + line)
      const trimmed = line.trim()
      if (trimmed) {
        logToFile('[backend stderr] ' + trimmed.replace(/\n/g, ' | '))
      }
    })
  }
}

function waitForBackend(port, maxMs = 15000) {
  return new Promise((resolve) => {
    const startedAt = Date.now()

    const tryConnect = () => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.destroy()
        resolve(true)
      })

      socket.once('error', () => {
        if (Date.now() - startedAt >= maxMs) {
          resolve(false)
          return
        }
        setTimeout(tryConnect, 300)
      })
    }

    tryConnect()
  })
}

const exitPyProc = () => {
  if (pyProc != null) {
    console.log('[Electron] Killing Python process...')

    if (isWindows) {
      try {
        execSync(`taskkill /pid ${pyProc.pid} /f /t`)
        console.log('[Electron] Taskkill executed successfully')
      } catch (error) {
        console.error('[Electron] Failed to taskkill (process might be already dead):', error.message)
      }
    } else {
      pyProc.kill()
    }

    pyProc = null
  }
}

function processBackendStdout(chunk) {
  backendStdoutBuffer += chunk
  if (Buffer.byteLength(backendStdoutBuffer, 'utf8') > 1024 * 1024) {
    backendStdoutBuffer = ''
    console.error('[Electron] Discarded oversized backend stdout line')
    return
  }
  let newlineIndex = backendStdoutBuffer.indexOf('\n')
  while (newlineIndex >= 0) {
    const line = backendStdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '')
    backendStdoutBuffer = backendStdoutBuffer.slice(newlineIndex + 1)
    try {
      const event = parseLegacyShadowEventLine(line)
      if (event) {
        if (localDatabase) localDatabase.appendScoreEvent(event)
      } else if (line.trim()) {
        console.log('py_stdout: ' + line)
        logToFile('[backend] ' + line.trim())
      }
    } catch (error) {
      console.error('[Electron] Failed to shadow-write legacy score event:', error.message)
    }
    newlineIndex = backendStdoutBuffer.indexOf('\n')
  }
}

function openLocalDatabase() {
  const dataRoot = getDataRoot(app)
  const database = new LocalDatabase(
    join(dataRoot, 'ft-engine.db'),
    join(dataRoot, 'backups')
  )
  database.open()
  localDatabase = database
  let imported
  try {
    imported = importLegacyProjects(database, join(dataRoot, 'match_data'))
  } catch (error) {
    closeLocalDatabase()
    throw error
  }
  console.log('[Electron] Local database ready:', database.databasePath)
  console.log(
    `[Electron] Legacy import: projects=${imported.projects}, imported=${imported.imported}, ` +
    `events=${imported.events}, errors=${imported.errors.length}`
  )
  logToFile(`Local database ready: ${database.databasePath}`)
  logToFile(
    `Legacy import: projects=${imported.projects}, imported=${imported.imported}, ` +
    `events=${imported.events}, errors=${imported.errors.length}`
  )
}

function getLegacyProjectRoot() {
  return join(getDataRoot(app), 'match_data')
}

function refreshLegacyProject(sourceKey) {
  try {
    const result = importLegacyProject(localDatabase, getLegacyProjectRoot(), sourceKey)
    if (result.imported) {
      logToFile(`Legacy project refreshed: source=${sourceKey}, events=${result.events}`)
    }
    return true
  } catch (error) {
    console.error(`[Electron] Failed to refresh legacy project ${sourceKey}:`, error.message)
    logToFile(`Legacy project refresh failed: source=${sourceKey}, error=${error.message}`)
    return false
  }
}

function closeLocalDatabase() {
  if (!localDatabase) return
  localDatabase.close()
  localDatabase = null
}

function getLocalDataTargets() {
  const dataRoot = getDataRoot(app)
  return [
    join(dataRoot, 'app_settings.json'),
    join(dataRoot, 'ft-engine.db'),
    join(dataRoot, 'ft-engine.db-shm'),
    join(dataRoot, 'ft-engine.db-wal'),
    join(dataRoot, 'backups'),
    join(dataRoot, 'exports'),
    join(dataRoot, 'match_data'),
    join(dataRoot, 'logs')
  ]
}

async function deleteLocalDataFiles() {
  await stopDeviceSessions('delete-local-data')
  await exitPlatformWorker()
  closeLocalDatabase()
  exitPyProc()
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
    env: getBackendEnv(app),
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
    logToFile('whenReady done, starting backend...')
  }

  electronApp.setAppUserModelId('com.freakthrow.FT Engine')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createPyProc()
  try {
    openLocalDatabase()
  } catch (error) {
    console.error('[Electron] Shadow database unavailable, legacy storage remains active:', error.message)
    logToFile(`Shadow database unavailable: ${error.message}`)
  }
  platformWorkerStopping = false
  try {
    await createPlatformWorker()
  } catch (error) {
    console.error('[Electron] Platform Worker unavailable, legacy backend remains active:', error.message)
    logToFile(`Platform Worker unavailable: ${error.message}`)
    schedulePlatformWorkerRestart()
  }

  if (!is.dev) {
    logToFile(`Waiting for backend on port ${appConfig.port}...`)
    const ready = await waitForBackend(appConfig.port)
    if (ready) {
      logToFile(`Backend ready on port ${appConfig.port}`)
    } else {
      console.warn('[Electron] Backend did not become ready in time, opening window anyway.')
      logToFile(`Backend not ready on port ${appConfig.port}, opening window anyway`)
    }
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
    exitPyProc()
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
    const rawRemarks = options.remarks && typeof options.remarks === 'object' && !Array.isArray(options.remarks)
      ? options.remarks : {}
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
    return Promise.all(value.map(async (item) => {
      if (
        !item ||
        typeof item.deviceId !== 'string' ||
        !item.deviceId ||
        item.deviceId.length > 128 ||
        typeof item.name !== 'string' ||
        !item.name.trim() ||
        Buffer.byteLength(item.name.trim(), 'utf8') > 32
      ) {
        return { deviceId: String(item?.deviceId || ''), name: String(item?.name || ''), status: 'error', error: 'INVALID_PARAMS' }
      }
      try {
        await platformWorker.request('device.renameDiscovered', {
          deviceId: item.deviceId,
          name: item.name.trim()
        }, 15000)
        return { deviceId: item.deviceId, name: item.name.trim(), status: 'ok' }
      } catch (error) {
        return { deviceId: item.deviceId, name: item.name.trim(), status: 'error', error: error.code || 'DEVICE_RENAME_FAILED' }
      }
    }))
  })

  ipcMain.handle(IPC_CHANNELS.match.start, async (event, input) => {
    assertMainSender(event)
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    const imported = importLegacyProject(
      localDatabase,
      getLegacyProjectRoot(),
      input?.sourceKey
    )
    if (!imported.found) throw new Error('MATCH_PROJECT_NOT_FOUND')
    if (!localDatabase.markLegacyProjectLive(input.sourceKey)) {
      throw new Error('MATCH_PROJECT_NOT_FOUND')
    }
    await disconnectLegacyDevices()
    return matchSession.start(input)
  })

  ipcMain.handle(IPC_CHANNELS.match.setContext, async (event, groupName, contestantName) => {
    assertMainSender(event)
    return matchSession.setContext(groupName, contestantName)
  })

  ipcMain.handle(IPC_CHANNELS.match.getStatus, (event) => {
    assertMainSender(event)
    return matchSession.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.match.syncPlayback, (event, playback) => {
    assertMainSender(event)
    if (!playback || typeof playback !== 'object' || Array.isArray(playback)) {
      throw new Error('IPC_INVALID_MATCH_PLAYBACK')
    }
    matchSession.updatePlayback(playback)
  })

  ipcMain.handle(
    IPC_CHANNELS.match.setMediaBinding,
    (event, groupName, contestantName, binding) => {
      assertMainSender(event)
      return matchSession.setMediaBinding(groupName, contestantName, binding)
    }
  )

  ipcMain.handle(IPC_CHANNELS.match.listScored, (event, sourceKey, groupName) => {
    assertMainSender(event)
    if (
      typeof sourceKey !== 'string' ||
      !sourceKey ||
      sourceKey.length > 256 ||
      typeof groupName !== 'string' ||
      !groupName ||
      groupName.length > 256
    ) {
      throw new Error('IPC_INVALID_MATCH_CONTEXT')
    }
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    return localDatabase.listLegacyScoredContestants(sourceKey, groupName)
  })

  ipcMain.handle(IPC_CHANNELS.match.reset, async (event) => {
    assertMainSender(event)
    return matchSession.reset()
  })

  ipcMain.handle(IPC_CHANNELS.match.stop, async (event) => {
    assertMainSender(event)
    return stopDeviceSessions('score-page-exit')
  })

  ipcMain.handle(
    IPC_CHANNELS.replay.getLegacy,
    (event, sourceKey, groupName, contestantName) => {
      assertMainSender(event)
      for (const value of [sourceKey, groupName, contestantName]) {
        if (typeof value !== 'string' || !value || value.length > 256) {
          throw new Error('IPC_INVALID_REPLAY_CONTEXT')
        }
      }
      if (!localDatabase) throw new Error('DATABASE_NOT_READY')
      if (!refreshLegacyProject(sourceKey)) throw new Error('LEGACY_IMPORT_FAILED')
      return localDatabase.getLegacyReplay(sourceKey, groupName, contestantName)
    }
  )

  ipcMain.handle(IPC_CHANNELS.reports.getLegacy, (event, sourceKey) => {
    assertMainSender(event)
    if (typeof sourceKey !== 'string' || !sourceKey || sourceKey.length > 256) {
      throw new Error('IPC_INVALID_REPORT_CONTEXT')
    }
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    if (!refreshLegacyProject(sourceKey)) throw new Error('LEGACY_IMPORT_FAILED')
    return localDatabase.getLegacyReport(sourceKey)
  })

  ipcMain.handle(IPC_CHANNELS.projects.listLegacy, (event) => {
    assertMainSender(event)
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    const imported = importLegacyProjects(localDatabase, getLegacyProjectRoot())
    if (imported.errors.length > 0) throw new Error('LEGACY_IMPORT_FAILED')
    return localDatabase.listLegacyProjects()
  })

  ipcMain.handle(IPC_CHANNELS.projects.deleteLegacy, (event, sourceKey) => {
    assertMainSender(event)
    if (typeof sourceKey !== 'string' || !sourceKey || sourceKey.length > 256) {
      throw new Error('IPC_INVALID_PROJECT_SOURCE')
    }
    if (!localDatabase) throw new Error('DATABASE_NOT_READY')
    if (!localDatabase.getLegacyImportSummary(sourceKey)) return false
    deleteLegacyProjectSource(getLegacyProjectRoot(), sourceKey)
    return localDatabase.deleteLegacyProject(sourceKey)
  })

  ipcMain.handle(IPC_CHANNELS.app.getServerConfig, (event) => {
    assertMainSender(event)
    return appConfig
  })

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
        console.log('[Electron] Detected minimized/off-screen target, resetting overlay to primary display.')
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
  exitPyProc()
})

app.on('window-all-closed', async () => {
  if (!isMac) {
    exitPyProc()
    await exitPlatformWorker()
    closeLocalDatabase()
    app.quit()
  }
})
