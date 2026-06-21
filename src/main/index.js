import { app, shell, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import yaml from 'js-yaml'
import fs from 'fs'
import { getBackendEnv, getBackendLaunchConfig, getConfigPath, getDataRoot, isWindows } from './platform'

const { spawn, execSync } = require('child_process')
const net = require('net')

let pyProc = null
let mainWindow = null
let overlayWindow = null
const MAIN_WINDOW_TITLE = 'FT Engine'
const OVERLAY_WINDOW_TITLE = 'FT Engine Overlay'

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
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (!is.dev) {
      autoUpdater.checkForUpdatesAndNotify()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.on('close', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close()
      overlayWindow = null
    }
    if (process.platform === 'darwin') {
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
    if (mainWindow) mainWindow.webContents.send('update_available')
  })

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update_downloaded')
  })

  ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.on('register-global-shortcut', (event, shortcut) => {
    globalShortcut.unregisterAll()

    if (!shortcut) return

    try {
      const registered = globalShortcut.register(shortcut, () => {
        console.log('[Electron] Global shortcut triggered:', shortcut)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-shortcut-action')
        }
      })

      if (!registered) {
        console.log('[Electron] Global shortcut registration failed')
      }
    } catch (error) {
      console.error('[Electron] Error registering shortcut:', error)
    }
  })

  ipcMain.on('unregister-global-shortcut', () => {
    globalShortcut.unregisterAll()
    console.log('[Electron] Global shortcuts unregistered')
  })

  ipcMain.handle('get-server-config', () => {
    return appConfig
  })

  ipcMain.handle('delete-local-data', async () => {
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

  ipcMain.on('set-main-content-protection', (event, enabled) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setContentProtection(!!enabled)
    }
  })

  ipcMain.on('window-max', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.on('overlay-ready', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && win.initialOverlayData) {
      win.webContents.send('init-overlay-data', win.initialOverlayData)
    }
  })

  ipcMain.on('open-overlay', (event, { bounds, initialState } = {}) => {
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
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false
      }
    })
    overlayWindow.setContentProtection(false)

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
        overlayWindow.webContents.send('init-overlay-data', initialState)
      }
    })

    overlayWindow.on('closed', () => {
      overlayWindow = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('overlay-closed')
      }
    })
  })

  ipcMain.on('close-overlay', () => {
    if (overlayWindow) {
      overlayWindow.close()
    }
  })

  ipcMain.on('set-ignore-mouse', (event, ignore) => {
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

  ipcMain.on('window-min', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.minimize()
  })

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.close()
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  exitPyProc()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    exitPyProc()
    app.quit()
  }
})
