import { app, shell, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron'
import { join, dirname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater' // --- 新增：引入自动更新模块 ---
import icon from '../../resources/icon.png?asset'
import yaml from 'js-yaml'
import fs from 'fs'
// 【修改 1】引入 execSync 用于同步执行命令
const { spawn, execSync } = require('child_process')

let pyProc = null
let mainWindow = null
let overlayWindow = null

// --- 新增：读取配置端口函数 ---
// 用于前端获取正确的后端端口 (优先读取 config.yaml)
function getAppConfig() {
  let port = 8000 // 默认端口，作为兜底
  try {
    let configPath = ''
    if (app.isPackaged) {
      // 打包后：优先 resources，其次 exe 同级目录
      const resourceConfig = join(process.resourcesPath, 'config.yaml')
      const exeConfig = join(dirname(app.getPath('exe')), 'config.yaml')
      if (fs.existsSync(resourceConfig)) {
        configPath = resourceConfig
      } else {
        configPath = exeConfig
      }
      console.log('Config Path (Prod):', configPath)
    } else {
      // 开发时：使用 process.cwd() 获取项目根目录
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
    console.log('[Electron] Python process started, PID:', pyProc.pid)
    pyProc.stdout.on('data', function (data) {
      console.log('py_stdout: ' + data)
    })
    pyProc.stderr.on('data', function (data) {
      console.log('py_stderr: ' + data)
    })
  }
}

// --- 2. 关闭 Python 后端 (关键修改) ---
const exitPyProc = () => {
  if (pyProc != null) {
    console.log('[Electron] Killing Python process...')

    // 针对 Windows 系统使用 taskkill 强制结束进程树
    if (process.platform === 'win32') {
      try {
        // 【修改 2】使用 execSync 同步执行，阻塞主进程直到杀进程命令完成
        // /pid: 指定进程ID, /f: 强制结束, /t: 结束该进程及其启动的所有子进程
        execSync(`taskkill /pid ${pyProc.pid} /f /t`)
        console.log('[Electron] Taskkill executed successfully')
      } catch (e) {
        // 忽略进程可能已经不存在的错误
        console.error('[Electron] Failed to taskkill (process might be already dead):', e.message)
      }
    } else {
      // macOS / Linux 使用标准的 kill 信号
      pyProc.kill()
    }

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
    // --- 新增：窗口加载完成后自动检查更新 ---
    if (!is.dev) {
      autoUpdater.checkForUpdatesAndNotify()
    }
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

  // === 自动更新事件监听 (PC软件) ===

  // 发现新版本
  autoUpdater.on('update-available', () => {
    if (mainWindow) mainWindow.webContents.send('update_available')
  })

  // 更新已下载，准备安装
  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update_downloaded')
  })

  // 前端触发：重启并安装更新
  ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall()
  })

  // === IPC 事件监听 ===

  // === 新增：全局快捷键管理 ===

  // 注册快捷键
  ipcMain.on('register-global-shortcut', (event, shortcut) => {
    // 先清空旧的，防止重复
    globalShortcut.unregisterAll()

    if (!shortcut) return

    try {
      // 注册新快捷键
      const ret = globalShortcut.register(shortcut, () => {
        console.log('[Electron] Global shortcut triggered:', shortcut)
        // 收到快捷键后，通知主窗口执行操作
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-shortcut-action')
        }
      })

      if (!ret) {
        console.log('[Electron] Global shortcut registration failed')
      }
    } catch (error) {
      console.error('[Electron] Error registering shortcut:', error)
    }
  })

  // 注销快捷键 (通常在离开计分板页面时调用)
  ipcMain.on('unregister-global-shortcut', () => {
    globalShortcut.unregisterAll()
    console.log('[Electron] Global shortcuts unregistered')
  })

  // 0. 新增：前端获取服务端配置（端口）
  ipcMain.handle('get-server-config', () => {
    return appConfig
  })

  // 0.1 主窗口内容保护（避免 OBS 捕获）
  ipcMain.on('set-main-content-protection', (event, enabled) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setContentProtection(!!enabled)
    }
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

  // 【新增】监听 Overlay 准备就绪，发送数据（解决窗口模式下数据不显示的竞态问题）
  ipcMain.on('overlay-ready', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    // 如果窗口实例上挂载了初始化数据，则发送给渲染进程
    if (win && win.initialOverlayData) {
      win.webContents.send('init-overlay-data', win.initialOverlayData)
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
      // 【修改】增加边界检查：如果目标窗口被最小化（坐标极小），强制重置到主屏幕
      // 避免悬浮窗被创建在屏幕外导致不可见
      if (bounds.x < -10000 || bounds.y < -10000) {
          console.log('[Electron] Detected minimized/off-screen target, resetting overlay to primary display.')
          // 保持默认的 winX/winY/winW/winH (主屏幕全屏)
      } else {
          winX = Math.round(bounds.x)
          winY = Math.round(bounds.y)
          winW = Math.round(bounds.width)
          winH = Math.round(bounds.height)
      }
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
    // 确保悬浮窗不启用内容保护（避免影响 OBS 捕获）
    overlayWindow.setContentProtection(false)

    // 【新增】将初始化数据暂存到窗口对象上，供 overlay-ready 事件提取
    if (initialState) {
        overlayWindow.initialOverlayData = initialState
    }

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?mode=overlay`)
    } else {
      overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: 'mode=overlay' })
    }

    overlayWindow.setIgnoreMouseEvents(true, { forward: true })

    // 保留原有逻辑作为兜底（主要用于全屏模式下可能较快触发的情况）
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

// 确保在任何退出场景下都清理后端
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  exitPyProc()
})

app.on('window-all-closed', () => {
  // 显式清理，防止窗口关闭但 app 进程残留导致后端未退出
  exitPyProc()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
