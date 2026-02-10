import { app, shell, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater' // --- 新增：引入自动更新模块 ---
import icon from '../../resources/icon.png?asset'
import yaml from 'js-yaml'
import fs from 'fs'
// 【修改 1】引入 execSync 用于同步执行命令
const { spawn, execSync } = require('child_process')
const net = require('net')

let pyProc = null
let mainWindow = null
let overlayWindow = null

// --- 启动日志（打包后从 DMG 启动时无终端，可查看此文件分析各阶段耗时）---
let startupLogStream = null
let startupLogPath = null
let startupT0 = 0
function initStartupLog() {
  try {
    const dir = app.getPath('userData')
    const logDir = join(dir, 'logs')
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
    startupLogPath = join(logDir, 'startup.log')
    startupLogStream = fs.createWriteStream(startupLogPath, { flags: 'a' })
    startupT0 = Date.now()
    const line = (msg) => startupLogStream.write(msg + '\n')
    line('')
    line('========== ' + new Date().toISOString() + ' ==========')
    line('Log file: ' + startupLogPath)
    line('View: tail -f "' + startupLogPath + '"  or open in Finder')
    line('T+0ms    app.whenReady()')
    return startupLogPath
  } catch (e) {
    console.error('[Electron] Failed to init startup log:', e)
    return null
  }
}
function logToFile(msg) {
  if (!startupLogStream) return
  const ms = Date.now() - startupT0
  try {
    startupLogStream.write(`T+${ms}ms    ${msg}\n`)
  } catch (e) {
    console.error('[Electron] logToFile error:', e)
  }
}

// --- 读取配置端口函数 ---
// 用于前端获取正确的后端端口 (优先读取 config.yaml)
function getAppConfig() {
  let port = 8000 // 默认端口，作为兜底
  try {
    let configPath = ''
    if (app.isPackaged) {
      // 打包后：config.yaml 被放在 app 的 Resources 目录中
      // 使用 process.resourcesPath，确保与 backend-engine / server.py 读取的路径一致
      configPath = join(process.resourcesPath, 'config.yaml')
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
    // macOS: 优先使用 .venv-mac 虚拟环境中的 Python
    if (process.platform === 'darwin') {
      const venvPython = join(process.cwd(), '.venv-mac', 'bin', 'python')
      const venvPython3 = join(process.cwd(), '.venv-mac', 'bin', 'python3')
      if (fs.existsSync(venvPython)) {
        cmd = venvPython
        console.log('[Electron] Using .venv-mac Python:', cmd)
      } else if (fs.existsSync(venvPython3)) {
        cmd = venvPython3
        console.log('[Electron] Using .venv-mac Python:', cmd)
      } else {
        cmd = 'python3'
        console.log('[Electron] .venv-mac not found, using system python3')
      }
    } else {
      cmd = 'python3'
    }
    args = [script]
    console.log('Starting Python backend (Dev):', script)
  } else {
    // macOS: onedir 打包，可执行文件在 backend-engine/backend-engine（避免 onefile 解包导致 30s+ 启动延迟）
    // Windows: onefile 单文件 backend-engine.exe
    if (process.platform === 'darwin') {
      script = join(process.resourcesPath, 'backend-engine', 'backend-engine')
    } else {
      script = join(process.resourcesPath, 'backend-engine.exe')
    }
    cmd = script
    args = []
    console.log('Starting Python backend (Prod):', script)
  }

  pyProc = spawn(cmd, args)

  if (pyProc != null) {
    console.log('[Electron] Python process started, PID:', pyProc.pid)
    logToFile('Backend process spawned, PID: ' + pyProc.pid)
    const writeBackendLog = (prefix, data) => {
      const s = (data && data.toString) ? data.toString().trim() : String(data)
      if (s) logToFile(prefix + ' ' + s.replace(/\n/g, ' | '))
    }
    pyProc.stdout.on('data', function (data) {
      console.log('py_stdout: ' + data)
      writeBackendLog('[backend]', data)
    })
    pyProc.stderr.on('data', function (data) {
      console.log('py_stderr: ' + data)
      writeBackendLog('[backend stderr]', data)
    })
  }
}

// 等待后端在 port 上开始监听再 resolve（打包后后端启动慢，避免前端先连导致 ERR_CONNECTION_REFUSED）
function waitForBackend(port, maxMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now()
    const tryConnect = () => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.destroy()
        resolve(true)
      })
      sock.once('error', () => {
        if (Date.now() - start >= maxMs) {
          resolve(false)
          return
        }
        setTimeout(tryConnect, 300)
      })
    }
    tryConnect()
  })
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

  // 点击叉号视为完全退出：先关悬浮窗，再退出应用（等同 Cmd+Q，会触发 will-quit 并关闭后端）
  mainWindow.on('close', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close()
      overlayWindow = null
    }
    app.quit()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- 4. 应用生命周期与 IPC 事件 ---
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
  // 打包后：后端进程启动需要时间，等其监听端口后再打开窗口，避免前端先连报 ERR_CONNECTION_REFUSED
  if (!is.dev) {
    const port = appConfig.port
    logToFile('Waiting for backend on port ' + port + '...')
    const t1 = Date.now()
    const ready = await waitForBackend(port)
    const waitMs = Date.now() - t1
    if (!ready) {
      console.warn('[Electron] Backend did not become ready in time, opening window anyway.')
      logToFile('Backend NOT ready after ' + waitMs + 'ms, opening window anyway')
    } else {
      console.log('[Electron] Backend ready on port', port)
      logToFile('Backend ready on port ' + port + ' (waited ' + waitMs + 'ms)')
    }
  }
  logToFile('Creating main window...')
  createWindow()
  logToFile('Main window created, startup complete.')
  if (startupLogPath) logToFile('Log path: ' + startupLogPath)

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
  // Windows / Linux：关掉所有窗口就退出应用并关闭后端
  if (process.platform !== 'darwin') {
    exitPyProc()
    app.quit()
  }
  // macOS：遵循平台习惯，关闭所有窗口时继续保留应用和后端进程，
  // 下次点击 Dock 图标只需重新创建窗口即可，避免“UI 关掉后后端也被杀、再开连不上”的问题
})
