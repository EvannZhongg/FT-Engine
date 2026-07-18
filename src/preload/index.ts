import { contextBridge, ipcRenderer } from 'electron'
import { type FtEngineApi, type Unsubscribe } from '../shared/ipc-contract'

type IpcChannels = typeof import('../shared/ipc-contract').IPC_CHANNELS

const IPC_CHANNELS = {
  app: {
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
    getWindowBounds: 'platform:get-window-bounds',
    retryWorker: 'platform:retry-worker'
  },
  devices: {
    scan: 'devices:scan',
    rename: 'devices:rename'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set'
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
    invalidate: 'match:invalidate',
    refereeUpdated: 'match:referee-updated',
    contextUpdated: 'match:context-updated',
    statusUpdated: 'match:status-updated'
  },
  replay: {
    get: 'replay:get'
  },
  reports: {
    get: 'reports:get'
  },
  projects: {
    create: 'projects:create',
    update: 'projects:update',
    get: 'projects:get',
    list: 'projects:list',
    delete: 'projects:delete'
  },
  stages: {
    list: 'stages:list',
    create: 'stages:create',
    update: 'stages:update',
    reorder: 'stages:reorder',
    delete: 'stages:delete',
    activate: 'stages:activate',
    complete: 'stages:complete'
  },
  exports: {
    saveDetails: 'exports:save-details',
    saveReport: 'exports:save-report'
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
      ipcRenderer.invoke(IPC_CHANNELS.platform.getWindowBounds, windowId),
    retryWorker: () => ipcRenderer.invoke(IPC_CHANNELS.platform.retryWorker)
  },
  devices: {
    scan: (options) => ipcRenderer.invoke(IPC_CHANNELS.devices.scan, options),
    rename: (requests) => ipcRenderer.invoke(IPC_CHANNELS.devices.rename, requests)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settings.get),
    set: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.settings.set, key, value)
  },
  match: {
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.match.start, input),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.match.getStatus),
    setContext: (groupName, contestantName) =>
      ipcRenderer.invoke(IPC_CHANNELS.match.setContext, groupName, contestantName),
    syncPlayback: (playback) => ipcRenderer.invoke(IPC_CHANNELS.match.syncPlayback, playback),
    setMediaBinding: (groupName, contestantName, url) =>
      ipcRenderer.invoke(IPC_CHANNELS.match.setMediaBinding, groupName, contestantName, url),
    listScored: (sourceKey, stageId, groupName, attemptNumber) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.match.listScored,
        sourceKey,
        stageId,
        groupName,
        attemptNumber
      ),
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.match.reset),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.match.stop),
    invalidate: () => ipcRenderer.invoke(IPC_CHANNELS.match.invalidate),
    onRefereeUpdated: (callback) => subscribe(IPC_CHANNELS.match.refereeUpdated, callback),
    onContextUpdated: (callback) => subscribe(IPC_CHANNELS.match.contextUpdated, callback),
    onStatusUpdated: (callback) => subscribe(IPC_CHANNELS.match.statusUpdated, callback)
  },
  replay: {
    get: (sourceKey, groupName, contestantName) =>
      ipcRenderer.invoke(IPC_CHANNELS.replay.get, sourceKey, groupName, contestantName)
  },
  reports: {
    get: (sourceKey) => ipcRenderer.invoke(IPC_CHANNELS.reports.get, sourceKey)
  },
  projects: {
    create: (name, mode) => ipcRenderer.invoke(IPC_CHANNELS.projects.create, name, mode),
    update: (sourceKey, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.projects.update, sourceKey, input),
    get: (sourceKey) => ipcRenderer.invoke(IPC_CHANNELS.projects.get, sourceKey),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.projects.list),
    delete: (sourceKey) => ipcRenderer.invoke(IPC_CHANNELS.projects.delete, sourceKey)
  },
  stages: {
    list: (competitionId) => ipcRenderer.invoke(IPC_CHANNELS.stages.list, competitionId),
    create: (competitionId, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.stages.create, competitionId, input),
    update: (stageId, input) => ipcRenderer.invoke(IPC_CHANNELS.stages.update, stageId, input),
    reorder: (competitionId, stageIds) =>
      ipcRenderer.invoke(IPC_CHANNELS.stages.reorder, competitionId, stageIds),
    delete: (stageId) => ipcRenderer.invoke(IPC_CHANNELS.stages.delete, stageId),
    activate: (stageId) => ipcRenderer.invoke(IPC_CHANNELS.stages.activate, stageId),
    complete: (stageId) => ipcRenderer.invoke(IPC_CHANNELS.stages.complete, stageId)
  },
  exports: {
    saveDetails: (request) => ipcRenderer.invoke(IPC_CHANNELS.exports.saveDetails, request),
    saveReport: (request) => ipcRenderer.invoke(IPC_CHANNELS.exports.saveReport, request)
  },
  overlay: {
    open: (options) => ipcRenderer.send(IPC_CHANNELS.overlay.open, options),
    close: () => ipcRenderer.send(IPC_CHANNELS.overlay.close)
  }
} satisfies FtEngineApi

contextBridge.exposeInMainWorld('ftEngine', ftEngine)
