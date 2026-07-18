import { contextBridge, ipcRenderer } from 'electron'
import { type FtEngineApi, type Unsubscribe } from '../shared/ipc-contract'

type IpcChannels = typeof import('../shared/ipc-contract').IPC_CHANNELS

const IPC_CHANNELS = {
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
    scan: 'devices:scan',
    rename: 'devices:rename'
  },
  match: {
    start: 'match:start',
    getStatus: 'match:get-status',
    setContext: 'match:set-context',
    syncPlayback: 'match:sync-playback',
    setMediaBinding: 'match:set-media-binding',
    listScored: 'match:list-scored',
    reset: 'match:reset',
    stop: 'match:stop',
    refereeUpdated: 'match:referee-updated',
    contextUpdated: 'match:context-updated',
    statusUpdated: 'match:status-updated'
  },
  replay: {
    getLegacy: 'replay:get-legacy'
  },
  reports: {
    getLegacy: 'reports:get-legacy'
  },
  projects: {
    listLegacy: 'projects:list-legacy',
    deleteLegacy: 'projects:delete-legacy'
  },
  overlay: {
    open: 'overlay:open',
    close: 'overlay:close',
    ready: 'overlay:ready',
    setClickThrough: 'overlay:set-click-through',
    initialData: 'overlay:initial-data'
  }
} as const satisfies IpcChannels

function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const ftEngine = {
  app: {
    getServerConfig: () => ipcRenderer.invoke(IPC_CHANNELS.app.getServerConfig),
    deleteLocalData: () => ipcRenderer.invoke(IPC_CHANNELS.app.deleteLocalData),
    restartForUpdate: () => ipcRenderer.send(IPC_CHANNELS.app.restartForUpdate),
    onUpdateAvailable: (callback) => subscribe(IPC_CHANNELS.app.updateAvailable, callback),
    onUpdateDownloaded: (callback) => subscribe(IPC_CHANNELS.app.updateDownloaded, callback)
  },
  window: {
    minimize: () => ipcRenderer.send(IPC_CHANNELS.window.minimize),
    toggleMaximize: () => ipcRenderer.send(IPC_CHANNELS.window.toggleMaximize),
    close: () => ipcRenderer.send(IPC_CHANNELS.window.close),
    setContentProtection: (enabled) =>
      ipcRenderer.send(IPC_CHANNELS.window.setContentProtection, Boolean(enabled))
  },
  shortcuts: {
    register: (shortcut) => ipcRenderer.invoke(IPC_CHANNELS.shortcuts.register, shortcut),
    unregister: () => ipcRenderer.send(IPC_CHANNELS.shortcuts.unregister),
    onTriggered: (callback) => subscribe(IPC_CHANNELS.shortcuts.triggered, callback)
  },
  platform: {
    listWindows: () => ipcRenderer.invoke(IPC_CHANNELS.platform.listWindows),
    getWindowBounds: (windowId) =>
      ipcRenderer.invoke(IPC_CHANNELS.platform.getWindowBounds, windowId)
  },
  devices: {
    scan: (options) => ipcRenderer.invoke(IPC_CHANNELS.devices.scan, options),
    rename: (requests) => ipcRenderer.invoke(IPC_CHANNELS.devices.rename, requests)
  },
  match: {
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.match.start, input),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.match.getStatus),
    setContext: (groupName, contestantName) =>
      ipcRenderer.invoke(IPC_CHANNELS.match.setContext, groupName, contestantName),
    syncPlayback: (playback) => ipcRenderer.invoke(IPC_CHANNELS.match.syncPlayback, playback),
    setMediaBinding: (groupName, contestantName, binding) =>
      ipcRenderer.invoke(IPC_CHANNELS.match.setMediaBinding, groupName, contestantName, binding),
    listScored: (sourceKey, groupName) =>
      ipcRenderer.invoke(IPC_CHANNELS.match.listScored, sourceKey, groupName),
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.match.reset),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.match.stop),
    onRefereeUpdated: (callback) => subscribe(IPC_CHANNELS.match.refereeUpdated, callback),
    onContextUpdated: (callback) => subscribe(IPC_CHANNELS.match.contextUpdated, callback),
    onStatusUpdated: (callback) => subscribe(IPC_CHANNELS.match.statusUpdated, callback)
  },
  replay: {
    getLegacy: (sourceKey, groupName, contestantName) =>
      ipcRenderer.invoke(IPC_CHANNELS.replay.getLegacy, sourceKey, groupName, contestantName)
  },
  reports: {
    getLegacy: (sourceKey) => ipcRenderer.invoke(IPC_CHANNELS.reports.getLegacy, sourceKey)
  },
  projects: {
    listLegacy: () => ipcRenderer.invoke(IPC_CHANNELS.projects.listLegacy),
    deleteLegacy: (sourceKey) => ipcRenderer.invoke(IPC_CHANNELS.projects.deleteLegacy, sourceKey)
  },
  overlay: {
    open: (options) => ipcRenderer.send(IPC_CHANNELS.overlay.open, options),
    close: () => ipcRenderer.send(IPC_CHANNELS.overlay.close)
  }
} satisfies FtEngineApi

contextBridge.exposeInMainWorld('ftEngine', ftEngine)
