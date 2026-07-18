import {
  BrowserWindow,
  screen,
  type App,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../shared/ipc-contract.ts'
import { normalizeOverlayOptions } from '../security.mjs'
import { calculateMainWindowLayout } from './window-layout.mts'

const MAIN_WINDOW_TITLE = 'FT Engine'
const OVERLAY_WINDOW_TITLE = 'FT Engine Overlay'

interface DesktopWindowManagerDependencies {
  app: App
  icon: string
  isDevelopment: boolean
  isMac: boolean
  rendererUrl?: string
  stopDeviceSessions: (reason: string) => Promise<unknown>
  openExternalUrl: (value: unknown) => void
  checkForUpdates: () => void
}

export class DesktopWindowManager {
  private readonly dependencies: DesktopWindowManagerDependencies
  private mainWindow: BrowserWindow | null = null
  private overlayWindow: BrowserWindow | null = null
  private overlayInitialState: unknown = null
  private mainWindowCloseInProgress = false

  constructor(dependencies: DesktopWindowManagerDependencies) {
    this.dependencies = dependencies
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow
  }

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow
    this.mainWindowCloseInProgress = false
    const layout = calculateMainWindowLayout(screen.getPrimaryDisplay().workArea)
    const window = new BrowserWindow({
      title: MAIN_WINDOW_TITLE,
      ...layout,
      show: false,
      autoHideMenuBar: true,
      frame: false,
      transparent: false,
      backgroundColor: '#1e1e1e',
      hasShadow: true,
      resizable: true,
      icon: this.dependencies.icon,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
    this.mainWindow = window

    window.on('ready-to-show', () => {
      if (window.isDestroyed()) return
      window.show()
      if (!this.dependencies.isDevelopment) this.dependencies.checkForUpdates()
    })
    window.webContents.setWindowOpenHandler((details) => {
      this.dependencies.openExternalUrl(details.url)
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      this.dependencies.openExternalUrl(url)
    })
    window.on('close', (event) => {
      if (this.mainWindowCloseInProgress) return
      event.preventDefault()
      this.mainWindowCloseInProgress = true
      void this.dependencies.stopDeviceSessions('window-close').finally(() => {
        this.closeOverlay()
        if (!window.isDestroyed()) window.destroy()
        if (this.dependencies.isMac) this.dependencies.app.quit()
      })
    })
    window.on('closed', () => {
      if (this.mainWindow === window) this.mainWindow = null
    })

    if (this.dependencies.isDevelopment && this.dependencies.rendererUrl) {
      void window.loadURL(this.dependencies.rendererUrl)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'))
    }
    return window
  }

  openOverlay(value: unknown): void {
    let options
    try {
      options = normalizeOverlayOptions(value)
    } catch (error) {
      console.warn(
        '[Electron] Rejected overlay options:',
        error instanceof Error ? error.message : ''
      )
      return
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.focus()
      return
    }

    const { bounds, initialState } = options
    const workArea = screen.getPrimaryDisplay().workArea
    let winX = workArea.x
    let winY = workArea.y
    let winW = workArea.width
    let winH = workArea.height
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

    const window = new BrowserWindow({
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
    this.overlayWindow = window
    this.overlayInitialState = initialState
    window.setContentProtection(false)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())

    if (this.dependencies.isDevelopment && this.dependencies.rendererUrl) {
      void window.loadURL(`${this.dependencies.rendererUrl}?mode=overlay`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'), { search: 'mode=overlay' })
    }
    window.setIgnoreMouseEvents(true, { forward: true })
    window.webContents.on('did-finish-load', () => {
      if (initialState && !window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.overlay.initialData, initialState)
      }
    })
    window.on('closed', () => {
      if (this.overlayWindow === window) {
        this.overlayWindow = null
        this.overlayInitialState = null
      }
    })
  }

  closeOverlay(): void {
    const window = this.overlayWindow
    this.overlayWindow = null
    this.overlayInitialState = null
    if (window && !window.isDestroyed()) window.close()
  }

  handleOverlayReady(event: IpcMainEvent, matchStatus: unknown): void {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (this.overlayInitialState) {
      window.webContents.send(IPC_CHANNELS.overlay.initialData, this.overlayInitialState)
    }
    window.webContents.send(IPC_CHANNELS.match.statusUpdated, matchStatus)
  }

  setOverlayClickThrough(event: IpcMainEvent, ignore: unknown): void {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (ignore) {
      window.setIgnoreMouseEvents(true, { forward: true })
    } else {
      window.setIgnoreMouseEvents(false)
      window.setAlwaysOnTop(true, 'screen-saver')
    }
  }

  setMainContentProtection(enabled: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setContentProtection(Boolean(enabled))
    }
  }

  toggleMaximize(event: IpcMainEvent): void {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  }

  minimize(event: IpcMainEvent): void {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  }

  closeMain(event: IpcMainEvent): void {
    BrowserWindow.fromWebContents(event.sender)?.close()
  }

  isSender(event: IpcMainEvent | IpcMainInvokeEvent, window: BrowserWindow | null): boolean {
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents)
  }

  assertMainSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
    if (!this.isSender(event, this.mainWindow)) throw new Error('IPC_UNAUTHORIZED')
  }

  rejectUnexpectedSender(
    event: IpcMainEvent | IpcMainInvokeEvent,
    window: BrowserWindow | null,
    channel: string
  ): boolean {
    if (this.isSender(event, window)) return false
    console.warn(`[Electron] Blocked unauthorized IPC: ${channel}`)
    return true
  }

  sendToMain(channel: string, payload?: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (payload === undefined) this.mainWindow.webContents.send(channel)
      else this.mainWindow.webContents.send(channel, payload)
    }
  }

  sendToAll(channel: string, payload: unknown): void {
    for (const window of [this.mainWindow, this.overlayWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }
}
