export const IPC_CHANNELS = {
  app: {
    getServerConfig: 'app:get-server-config',
    deleteLocalData: 'app:delete-local-data',
    restartForUpdate: 'app:restart-for-update',
    updateAvailable: 'app:update-available',
    updateDownloaded: 'app:update-downloaded'
  },
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
    setContentProtection: 'window:set-content-protection'
  },
  shortcuts: {
    register: 'shortcuts:register',
    unregister: 'shortcuts:unregister',
    triggered: 'shortcuts:triggered'
  },
  platform: {
    listWindows: 'platform:list-windows',
    getWindowBounds: 'platform:get-window-bounds'
  },
  devices: {
    scan: 'devices:scan'
  },
  overlay: {
    open: 'overlay:open',
    close: 'overlay:close',
    ready: 'overlay:ready',
    setClickThrough: 'overlay:set-click-through',
    initialData: 'overlay:initial-data'
  }
} as const

export type Unsubscribe = () => void

export interface ServerConfig {
  port: number
}

export interface DeleteLocalDataResult {
  ok: boolean
  deleted: string[]
  failed: Array<{ target: string; message: string }>
  dataRoot: string
}

export interface ShortcutRegistrationResult {
  ok: boolean
  error?: 'SHORTCUT_INVALID' | 'SHORTCUT_UNAVAILABLE'
}

export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PlatformWindow {
  windowId: string
  title: string
}

export interface WindowListResult {
  windows: PlatformWindow[]
}

export interface WindowBoundsResult {
  found: boolean
  bounds: OverlayBounds | null
}

export interface LocalDevice {
  name: string
  address: string
  deviceId: string
  rssi: number
  remark: string
  transport: 'BLE' | 'USB'
}

export interface DeviceScanResult {
  devices: LocalDevice[]
  errors: Array<{ transport: 'BLE' | 'USB'; code: string }>
}

export interface OverlayInitialState {
  referees: Record<string, unknown>
  context: Record<string, unknown>
  projectConfig: Record<string, unknown>
}

export interface OverlayOpenOptions {
  bounds: OverlayBounds | null
  initialState: OverlayInitialState
}

export interface FtEngineApi {
  app: {
    getServerConfig: () => Promise<ServerConfig>
    deleteLocalData: () => Promise<DeleteLocalDataResult>
    restartForUpdate: () => void
    onUpdateAvailable: (callback: () => void) => Unsubscribe
    onUpdateDownloaded: (callback: () => void) => Unsubscribe
  }
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    setContentProtection: (enabled: boolean) => void
  }
  shortcuts: {
    register: (shortcut: string) => Promise<ShortcutRegistrationResult>
    unregister: () => void
    onTriggered: (callback: () => void) => Unsubscribe
  }
  platform: {
    listWindows: () => Promise<WindowListResult>
    getWindowBounds: (windowId: string) => Promise<WindowBoundsResult>
  }
  devices: {
    scan: (options: { flush: boolean; remarks: Record<string, string> }) => Promise<DeviceScanResult>
  }
  overlay: {
    open: (options: OverlayOpenOptions) => void
    close: () => void
  }
}

export interface FtOverlayApi {
  ready: () => void
  close: () => void
  setClickThrough: (enabled: boolean) => void
  onInitialData: (callback: (data: OverlayInitialState) => void) => Unsubscribe
}
