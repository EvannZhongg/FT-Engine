import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
const { spawn } = require('child_process')

let pyProc = null

// --- 1. 启动 Python 后端 ---
const createPyProc = () => {
  let script = null
  let cmd = null
  let args = []

  if (is.dev) {
    // 开发环境：假设 server.py 在项目根目录
    script = join(__dirname, '../../server.py')
    cmd = 'python'
    args = [script]
    console.log('Starting Python backend (Dev):', script)
  } else {
    // 生产环境：运行打包后的 exe
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

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false, // 建议设为无边框，方便做自定义标题栏
    ...(process.platform === 'linux' ? { icon } : {}),
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

  // --- IPC 监听：处理窗口控制 ---

  // 1. 鼠标穿透控制 (用于悬浮窗模式)
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setIgnoreMouseEvents(ignore, options)
  })

  // 2. 窗口位置和大小更新 (用于窗口吸附功能)
  // 前端收到 Python 发来的坐标后，通知主进程修改窗口
  ipcMain.on('update-window-bounds', (event, bounds) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.setBounds(bounds)
    }
  })

  // 3. 基础窗口控制 (最小化/关闭)
  ipcMain.on('window-min', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.minimize()
  })
  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.close()
  })


  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createPyProc()
  createWindow()

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
