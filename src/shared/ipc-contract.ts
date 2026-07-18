import type { YouTubeMediaBinding } from './media/youtube.mts'
import type {
  CompetitionConfig,
  CompetitionGroupConfig,
  CompetitionListItem,
  CompetitionMode
} from './contracts/competition.mts'
import type {
  DetailExportRequest,
  ExportSaveResult,
  ReportExportRequest
} from './contracts/export.mts'
import type { CompetitionStageConfig, StageConfigInput } from './contracts/stage.mts'

export const IPC_CHANNELS = {
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
    getWindowBounds: 'platform:get-window-bounds'
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
} as const

export type Unsubscribe = () => void

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
}

export interface DeviceRenameRequest {
  deviceId: string
  name: string
}

export interface DeviceRenameResult extends DeviceRenameRequest {
  status: 'ok' | 'error'
  error?: string
}

export interface AppSettings {
  language: 'zh' | 'en' | 'ja'
  reset_shortcut: string
  suppress_reset_confirm: boolean
  suppress_zero_confirm: boolean
  device_remarks: Record<string, string>
  obs_protect_main: boolean
  project_preferences: Record<string, Record<string, string | number | boolean | null>>
}

export type AppSettingKey = keyof AppSettings

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
  attemptNumber: number
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

export interface ReplayResult {
  status: 'ok'
  binding: {
    provider: string
    video_id: string
    canonical_url: string
  } | null
  events: ReplayEvent[]
}

export interface ReportResult {
  status: 'ok'
  config: CompetitionConfig
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
  settings: {
    get: () => Promise<AppSettings>
    set: <K extends AppSettingKey>(key: K, value: AppSettings[K]) => Promise<AppSettings>
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
      url: string
    ) => Promise<YouTubeMediaBinding>
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
    get: (
      sourceKey: string,
      groupName: string,
      contestantName: string
    ) => Promise<ReplayResult | null>
  }
  reports: {
    get: (sourceKey: string) => Promise<ReportResult | null>
  }
  projects: {
    create: (projectName: string, mode: CompetitionMode) => Promise<CompetitionConfig>
    update: (
      sourceKey: string,
      input: {
        projectName: string
        mode: CompetitionMode
        groups: CompetitionGroupConfig[]
      }
    ) => Promise<CompetitionConfig>
    get: (sourceKey: string) => Promise<CompetitionConfig | null>
    list: () => Promise<CompetitionListItem[]>
    delete: (sourceKey: string) => Promise<boolean>
  }
  stages: {
    list: (competitionId: string) => Promise<CompetitionStageConfig[]>
    create: (competitionId: string, input: StageConfigInput) => Promise<CompetitionStageConfig>
    update: (stageId: string, input: StageConfigInput) => Promise<CompetitionStageConfig>
    reorder: (competitionId: string, stageIds: string[]) => Promise<CompetitionStageConfig[]>
    delete: (stageId: string) => Promise<boolean>
    activate: (stageId: string) => Promise<CompetitionStageConfig>
    complete: (stageId: string) => Promise<CompetitionStageConfig>
  }
  exports: {
    saveDetails: (request: DetailExportRequest) => Promise<ExportSaveResult>
    saveReport: (request: ReportExportRequest) => Promise<ExportSaveResult>
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
