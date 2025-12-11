import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
const { spawn } = require('child_process')

let pyProc = null
let mainWindow = null
let overlayWindow = null

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

// --- 3. 创建主窗口 (控制台) ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false, // 无边框
    transparent: true, // 开启透明支持
    hasShadow: false,
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- 4. 应用生命周期与 IPC 事件 ---
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 启动后台服务
  createPyProc()
  // 创建主界面
  createWindow()

  // === IPC 事件监听 ===

  // 1. 打开悬浮窗 (支持参数：bounds, initialState)
  ipcMain.on('open-overlay', (event, { bounds, initialState } = {}) => {
    // 如果悬浮窗已存在，则聚焦，不重复创建
    if (overlayWindow) {
      overlayWindow.focus()
      return
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    let winX = 0
    let winY = 0
    let winW = primaryDisplay.workAreaSize.width
    let winH = primaryDisplay.workAreaSize.height

    // 如果传递了 bounds，则应用 (实现“窗口匹配”功能)
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
      transparent: true,   // 透明背景
      frame: false,        // 无边框
      hasShadow: false,
      fullscreen: false,   // 不强制独占全屏，方便覆盖在其他应用之上
      alwaysOnTop: true,   // 始终置顶
      skipTaskbar: true,   // 不显示在任务栏
      resizable: true,     // 允许调整大小
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'), // 复用 preload
        sandbox: false,
        webSecurity: false
      }
    })

    // 加载页面，带上 mode=overlay 参数
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?mode=overlay`)
    } else {
      overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: 'mode=overlay' })
    }

    // 默认开启鼠标穿透 (点击背景透传)，配合 OverlayView 中的 set-ignore-mouse 使用
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })

    // 【关键修复】窗口加载完成后，立即发送初始状态数据
    overlayWindow.webContents.on('did-finish-load', () => {
      if (initialState) {
        // 通过 IPC 发送给 OverlayView.vue
        overlayWindow.webContents.send('init-overlay-data', initialState)
      }
    })

    // 处理关闭事件
    overlayWindow.on('closed', () => {
      overlayWindow = null
      // 通知主窗口悬浮窗已关闭 (可选，用于UI状态更新)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('overlay-closed')
      }
    })
  })

  // 2. 关闭悬浮窗
  ipcMain.on('close-overlay', () => {
    if (overlayWindow) {
      overlayWindow.close()
    }
  })

  // 3. 鼠标穿透控制 (通用，适用于发送事件的窗口)
  ipcMain.on('set-ignore-mouse', (event, ignore) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (ignore) {
        // ignore = true: 鼠标穿透，forward = true 表示把事件转发给系统
        win.setIgnoreMouseEvents(true, { forward: true })
      } else {
        // ignore = false: 鼠标不穿透 (可以点击按钮/卡片)
        win.setIgnoreMouseEvents(false)
        // 重新聚焦时确保置顶层级最高
        win.setAlwaysOnTop(true, 'screen-saver')
      }
    }
  })

  // 4. 窗口控制 (最小化/关闭)
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
