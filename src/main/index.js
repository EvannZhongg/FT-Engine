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

const { spawn, execSync } = require('child_process')
const net = require('net')

let pyProc = null
let platformWorker = null
let platformWorkerRestartTimer = null
let platformWorkerRestartCount = 0
let platformWorkerStopping = false
let mainWindow = null
let overlayWindow = null
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

const createPyProc = () => {
  const { cmd, args } = getBackendLaunchConfig(__dirname, is.dev)
  console.log(`[Electron] Starting Python backend (${is.dev ? 'Dev' : 'Prod'}):`, cmd, args)
  pyProc = spawn(cmd, args, { env: getBackendEnv(app) })

  if (pyProc != null) {
    console.log('[Electron] Python process started, PID:', pyProc.pid)
    logToFile('Backend process spawned, PID: ' + pyProc.pid)
    pyProc.stdout.on('data', function (data) {
      const line = data.toString()
      console.log('py_stdout: ' + line)
      const trimmed = line.trim()
      if (trimmed) {
        logToFile('[backend] ' + trimmed.replace(/\n/g, ' | '))
      }
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

function getLocalDataTargets() {
  const dataRoot = getDataRoot(app)
  return [
    join(dataRoot, 'app_settings.json'),
    join(dataRoot, 'match_data'),
    join(dataRoot, 'logs')
  ]
}

function deleteLocalDataFiles() {
  closeStartupLog()
  exitPyProc()
  if (platformWorker) {
    platformWorkerStopping = true
    platformWorker.terminate()
    platformWorker = null
  }

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
  worker.on('exit', ({ code, signal }) => {
    console.warn(`[Electron] Platform Worker exited (code=${code}, signal=${signal})`)
    if (platformWorker === worker) platformWorker = null
    schedulePlatformWorkerRestart()
  })

  try {
    await worker.start()
    const hello = await worker.request('system.hello')
    console.log('[Electron] Platform Worker ready:', hello)
    logToFile(`Platform Worker ready: ${JSON.stringify(hello)}`)
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

  mainWindow.on('close', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close()
      overlayWindow = null
    }
    if (isMac) {
      app.quit()
    }
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
    await exitPlatformWorker()
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

  ipcMain.handle(IPC_CHANNELS.app.getServerConfig, (event) => {
    assertMainSender(event)
    return appConfig
  })

  ipcMain.handle(IPC_CHANNELS.app.deleteLocalData, async (event) => {
    assertMainSender(event)
    const result = deleteLocalDataFiles()
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
    app.quit()
  }
})
