import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join, dirname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import yaml from 'js-yaml'
import fs from 'fs'
const { spawn } = require('child_process')

let pyProc = null
let mainWindow = null
let overlayWindow = null

// --- 新增：读取配置端口函数 ---
function getAppConfig() {
  let port = 8000 // 默认端口
  try {
    let configPath = ''
    if (app.isPackaged) {
      // 打包后：config.yaml 在 exe 同级目录
      configPath = join(dirname(app.getPath('exe')), 'config.yaml')
      console.log('Config Path (Prod):', configPath)
    } else {
      // 开发时：使用 process.cwd() 获取项目根目录 (ft_engine)
      configPath = join(process.cwd(), 'config.yaml')
      console.log('Config Path (Dev):', configPath)
    }

    if (fs.existsSync(configPath)) {
      const fileContents = fs.readFileSync(configPath, 'utf8')
      const config = yaml.load(fileContents)
      if (config && config.server_port) {
        port = config.server_port
        console.log(`[Electron] Loaded port from config: ${port}`)
      }
    } else {
      console.log(`[Electron] Config file not found, using default port 8000`)
    }
  } catch (e) {
    console.error('[Electron] Failed to load config:', e)
  }
  return { port }
}

// 缓存配置以便多次使用
const appConfig = getAppConfig()

// --- 1. 启动 Python 后端 ---
const createPyProc = () => {
  let script = null
  let cmd = null
  let args = []

  if (is.dev) {
    script = join(__dirname, '../../server.py')
    cmd = 'python'
    args = [script]
    console.log('Starting Python backend (Dev):', script)
  } else {
    script = join(process.resourcesPath, 'backend-engine.exe')
    cmd = script
    args = []
    console.log('Starting Python backend (Prod):', script)
  }

  pyProc = spawn(cmd, args)

  if (pyProc != null) {
    pyProc.stdout.on('data', function (data) {
      console.log('py_stdout: ' + data)
    })
    pyProc.stderr.on('data', function (data) {
      console.log('py_stderr: ' + data)
    })
  }
}

// --- 2. 关闭 Python 后端 ---
const exitPyProc = () => {
  if (pyProc != null) {
    console.log('Killing Python process...')
    pyProc.kill()
    pyProc = null
  }
}

// --- 3. 创建主窗口 (控制台) ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    // 【关键修改 1】关闭主窗口透明，解决最大化崩溃和无法还原的问题
    transparent: false,
    // 【关键修改 2】设置背景色，防止关闭透明后窗口变白
    backgroundColor: '#1e1e1e',
    hasShadow: true, // 关闭透明后，可以开启系统阴影让窗口更自然（可选）
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
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 监听主窗口关闭事件，同步关闭悬浮窗
  mainWindow.on('close', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close()
      overlayWindow = null
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- 4. 应用生命周期与 IPC 事件 ---
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.freakthrow.FT Engine')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createPyProc()
  createWindow()

  // === IPC 事件监听 ===

  // 0. 新增：前端获取服务端配置（端口）
  ipcMain.handle('get-server-config', () => {
    return appConfig
  })

  // 1. 最大化/还原窗口控制
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

  // 2. 打开悬浮窗
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
      winX = Math.round(bounds.x)
      winY = Math.round(bounds.y)
      winW = Math.round(bounds.width)
      winH = Math.round(bounds.height)
    }

    overlayWindow = new BrowserWindow({
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

  // 3. 关闭悬浮窗
  ipcMain.on('close-overlay', () => {
    if (overlayWindow) {
      overlayWindow.close()
    }
  })

  // 4. 鼠标穿透控制
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

  // 5. 窗口控制
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
  exitPyProc()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
