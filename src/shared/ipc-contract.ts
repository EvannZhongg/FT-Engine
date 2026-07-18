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

export interface DeviceShutdownStep {
  status: 'ok' | 'skipped' | 'error'
  error?: string
}

export interface MatchStopResult {
  ok: boolean
  worker: DeviceShutdownStep
  legacy: DeviceShutdownStep
}

export interface DeviceRenameRequest {
  deviceId: string
  name: string
}

export interface DeviceRenameResult extends DeviceRenameRequest {
  status: 'ok' | 'error'
  error?: string
}

export interface MatchRefereeBinding {
  index: number
  name: string
  mode: 'SINGLE' | 'DUAL'
  primaryDeviceId: string | null
  secondaryDeviceId: string | null
}

export interface MatchStartInput {
  sourceKey: string
  groupName: string
  contestantName: string
  referees: MatchRefereeBinding[]
}

export interface MatchRefereeUpdate {
  index: number
  name: string
  mode: 'SINGLE' | 'DUAL'
  score: { total: number; plus: number; minus: number; penalty: number }
  status: { pri: string; sec: string }
}

export interface MatchStatusUpdate {
  state: 'idle' | 'starting' | 'active' | 'stopping' | 'completed' | 'failed'
  persistence: 'idle' | 'saving' | 'saved' | 'error'
  worker: 'idle' | 'ready' | 'reconnecting' | 'error'
  media: 'not_ready' | 'aligned' | 'stale' | 'context_mismatch'
  errorCode: string | null
  lastSavedAt: string | null
}

export interface ReplayEvent {
  event_id: string
  system_time: string
  ble_timestamp: number
  referee_index: number
  referee_name: string
  device_role: 'PRIMARY' | 'SECONDARY'
  event_type: number
  delta_plus: number
  delta_minus: number
  delta_penalty: number
  total_plus: number
  total_minus: number
  major_penalty: number
  current_total: number
  media_provider: string
  media_id: string
  media_time_ms: number | null
  media_sync_status: string
}

export interface LegacyReplayResult {
  status: 'ok'
  binding: {
    provider: string
    video_id: string
    canonical_url: string
  } | null
  events: ReplayEvent[]
}

export interface LegacyReportResult {
  status: 'ok'
  config: {
    project_name: string
    mode: 'FREE' | 'TOURNAMENT'
    created_at: string
    groups: Array<{
      name: string
      refCount: number
      players: string[]
      referees: Array<{ index: number; name: string; mode: 'SINGLE' | 'DUAL' }>
    }>
    media: Record<string, Record<string, Record<string, string>>>
  }
  scores: Record<
    string,
    Record<
      string,
      Record<
        number,
        {
          total: number
          plus: number
          minus: number
          penalty: number
        }
      >
    >
  >
}

export type LegacyProjectSummary = LegacyReportResult['config'] & {
  dir_name: string
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
    scan: (options: {
      flush: boolean
      remarks: Record<string, string>
    }) => Promise<DeviceScanResult>
    rename: (requests: DeviceRenameRequest[]) => Promise<DeviceRenameResult[]>
  }
  match: {
    start: (input: MatchStartInput) => Promise<{
      connections: unknown[]
      status: MatchStatusUpdate
    }>
    getStatus: () => Promise<MatchStatusUpdate>
    setContext: (groupName: string, contestantName: string) => Promise<void>
    syncPlayback: (playback: Record<string, unknown>) => Promise<void>
    setMediaBinding: (
      groupName: string,
      contestantName: string,
      binding: { provider: string; mediaId: string; canonicalUrl: string }
    ) => Promise<boolean>
    listScored: (sourceKey: string, groupName: string) => Promise<string[]>
    reset: () => Promise<unknown>
    stop: () => Promise<MatchStopResult>
    onRefereeUpdated: (callback: (update: MatchRefereeUpdate) => void) => Unsubscribe
    onContextUpdated: (
      callback: (context: { groupName: string; contestantName: string }) => void
    ) => Unsubscribe
    onStatusUpdated: (callback: (status: MatchStatusUpdate) => void) => Unsubscribe
  }
  replay: {
    getLegacy: (
      sourceKey: string,
      groupName: string,
      contestantName: string
    ) => Promise<LegacyReplayResult | null>
  }
  reports: {
    getLegacy: (sourceKey: string) => Promise<LegacyReportResult | null>
  }
  projects: {
    listLegacy: () => Promise<LegacyProjectSummary[]>
    deleteLegacy: (sourceKey: string) => Promise<boolean>
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
  onRefereeUpdated: (callback: (update: MatchRefereeUpdate) => void) => Unsubscribe
  onContextUpdated: (
    callback: (context: { groupName: string; contestantName: string }) => void
  ) => Unsubscribe
  onStatusUpdated: (callback: (status: MatchStatusUpdate) => void) => Unsubscribe
}
