import { app, dialog, globalShortcut, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS, type MatchStopResult } from '../../shared/ipc-contract.ts'
import { CompetitionService } from '../application/competitions/competition-service.mts'
import { StageService } from '../application/competitions/stage-service.mts'
import { ExportService } from '../application/exports/export-service.mts'
import { DeviceLifecycle } from '../match/device-lifecycle.mjs'
import { MatchSessionService } from '../match/match-session.mts'
import { LocalDataManager } from '../persistence/local-data-manager.mts'
import { WorkerClient } from '../worker/worker-client.mjs'
import {
  ExportArtifactSaver,
  nodeExportFileWriter
} from '../infrastructure/filesystem/export-artifact-saver.mts'
import { StartupLog } from '../infrastructure/filesystem/startup-log.mts'
import { PlatformWorkerManager } from '../infrastructure/platform-worker/platform-worker-manager.mjs'
import { registerAppIpc } from '../ipc/register-app.mts'
import { registerCompetitionIpc } from '../ipc/register-competitions.mts'
import { registerDeviceIpc } from '../ipc/register-devices.mts'
import { registerExportIpc } from '../ipc/register-exports.mts'
import { registerMatchIpc } from '../ipc/register-matches.mts'
import { registerOverlayIpc } from '../ipc/register-overlay.mts'
import { registerPlatformIpc } from '../ipc/register-platform.mts'
import { registerQueryIpc } from '../ipc/register-queries.mts'
import { registerSettingsIpc } from '../ipc/register-settings.mts'
import { registerShortcutIpc } from '../ipc/register-shortcuts.mts'
import { registerStageIpc } from '../ipc/register-stages.mts'
import { registerWindowIpc } from '../ipc/register-windows.mts'
import {
  getDataRoot,
  getPlatformWorkerEnv,
  getPlatformWorkerLaunchConfig,
  isMac
} from '../platform.js'
import { normalizeExternalUrl } from '../security.mjs'
import { DesktopAppCommands } from './desktop-app-commands.mts'
import { registerAppLifecycle } from './lifecycle.mts'
import { registerUpdateNotifications } from './updates.mts'
import { DesktopWindowManager } from './windows.mts'

interface DesktopBootstrapOptions {
  icon: string
}

export function bootstrapDesktopApp(options: DesktopBootstrapOptions): void {
  void app.whenReady().then(() => initializeDesktopApp(options))
}

async function initializeDesktopApp({ icon }: DesktopBootstrapOptions): Promise<void> {
  const localData = new LocalDataManager(getDataRoot(app))
  const startupLog = new StartupLog(localData.dataRoot, {
    reportError: (operation, error) => {
      console.error(`[Electron] Failed to ${operation} startup log:`, error)
    }
  })
  if (app.isPackaged) {
    startupLog.init()
    startupLog.write('whenReady done')
  }

  electronApp.setAppUserModelId('com.freakthrow.FT Engine')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  let platformWorkerManager: PlatformWorkerManager | null = null
  let windowManager: DesktopWindowManager | null = null

  const deviceLifecycle = new DeviceLifecycle({
    disconnectWorker: async () => {
      if (!platformWorkerManager) return { skipped: true }
      return platformWorkerManager.disconnectAll()
    },
    onStopped: (reason: string, result: MatchStopResult) => {
      const message = `Device shutdown (${reason}): worker=${result.worker.status}`
      console.log('[Electron]', message)
      startupLog.write(message)
    }
  })

  const sendMatchEvent = (channel: string, payload: unknown): void => {
    windowManager?.sendToAll(channel, payload)
  }

  const matchSession = new MatchSessionService({
    requestWorker: (method, params = {}, timeoutMs) => {
      if (!platformWorkerManager) throw new Error('WORKER_NOT_RUNNING')
      return platformWorkerManager.request(method, params, timeoutMs)
    },
    persistEvent: (input) => localData.requireDatabase().appendMatchScoreEvent(input),
    activateContext: (context, occurredAt) => {
      localData.requireDatabase().activateMatchSession(context, occurredAt)
    },
    transitionContext: (current, next, occurredAt) => {
      localData.requireDatabase().transitionMatchSession(current, next, occurredAt)
    },
    completeContext: (context, occurredAt) => {
      localData.requireDatabase().completeMatchSession(context, occurredAt)
    },
    invalidateContext: (context, occurredAt) => {
      localData.requireDatabase().invalidateMatchSession(context, occurredAt)
    },
    validateContext: (...args) => localData.getDatabase()?.hasMatchContext(...args) ?? false,
    upsertMediaBinding: (...args) =>
      localData.getDatabase()?.upsertMediaBinding(...args) ?? false,
    emitRefereeUpdate: (update) =>
      sendMatchEvent(IPC_CHANNELS.match.refereeUpdated, update),
    emitContextUpdate: (context) =>
      sendMatchEvent(IPC_CHANNELS.match.contextUpdated, context),
    emitStatusUpdate: (status) => sendMatchEvent(IPC_CHANNELS.match.statusUpdated, status),
    onError: (code, error) => {
      console.error('[Electron] Match session error:', code, error || '')
      startupLog.write(`Match session error: ${code}`)
    }
  })

  const createPlatformWorkerClient = (): WorkerClient => {
    const { cmd, args } = getPlatformWorkerLaunchConfig(is.dev)
    return new WorkerClient({
      command: cmd,
      args,
      cwd: process.cwd(),
      env: getPlatformWorkerEnv(app),
      requestTimeoutMs: 3000
    })
  }

  platformWorkerManager = new PlatformWorkerManager({
    createClient: createPlatformWorkerClient,
    onEvent: (message: unknown) => matchSession.handleWorkerEvent(message),
    onUnavailable: () => matchSession.markWorkerUnavailable(),
    isSessionActive: () => matchSession.isActive(),
    reconnectSession: () => matchSession.reconnectWorker(),
    log: (level: string, message: string) => {
      if (level === 'error') console.error('[Electron]', message)
      else if (level === 'warn') console.warn('[Electron]', message)
      else console.log('[Electron]', message)
      startupLog.write(message)
    }
  })
  const workerManager = platformWorkerManager

  const competitionService = new CompetitionService({
    create: (input) => localData.requireDatabase().createCompetition(input),
    update: (sourceKey, input) =>
      localData.requireDatabase().updateCompetition(sourceKey, input),
    get: (sourceKey) => localData.requireDatabase().getCompetitionConfig(sourceKey),
    list: () => localData.requireDatabase().listCompetitionProjects(),
    delete: (sourceKey) => localData.requireDatabase().deleteCompetition(sourceKey)
  })

  const stageService = new StageService({
    list: (competitionId) => localData.requireDatabase().listStages(competitionId),
    create: (competitionId, input) =>
      localData.requireDatabase().createStage(competitionId, input),
    update: (stageId, input) => localData.requireDatabase().updateStage(stageId, input),
    reorder: (competitionId, stageIds) =>
      localData.requireDatabase().reorderStages(competitionId, stageIds),
    delete: (stageId) => localData.requireDatabase().deleteStage(stageId),
    activate: (stageId) => localData.requireDatabase().activateStage(stageId),
    complete: (stageId) => localData.requireDatabase().completeStage(stageId),
    appendFreeContestant: (stageId, groupName, contestantName) =>
      localData.requireDatabase().appendFreeContestant(stageId, groupName, contestantName)
  })

  const exportService = new ExportService(
    {
      getSnapshot: (sourceKey) =>
        localData.requireDatabase().getCompetitionExportSnapshot(sourceKey)
    },
    nodeExportFileWriter
  )

  const stopDeviceSessions = async (reason: string): Promise<MatchStopResult> => {
    const transitioned = matchSession.beginStopping()
    const result = (await deviceLifecycle.stop(reason)) as MatchStopResult
    if (transitioned) matchSession.completeStop(result.ok)
    return result
  }

  const openAllowedExternalUrl = (value: unknown): void => {
    const url = normalizeExternalUrl(value)
    if (!url) {
      console.warn('[Electron] Blocked external URL')
      return
    }
    void shell.openExternal(url).catch((error: Error) => {
      console.warn('[Electron] Failed to open external URL:', error.message)
    })
  }

  const windows = new DesktopWindowManager({
    app,
    icon,
    isDevelopment: is.dev,
    isMac,
    rendererUrl: process.env['ELECTRON_RENDERER_URL'],
    stopDeviceSessions,
    openExternalUrl: openAllowedExternalUrl,
    checkForUpdates: () => {
      void autoUpdater.checkForUpdatesAndNotify().catch((error: Error) => {
        console.warn('[Electron] Update check failed:', error.message)
      })
    }
  })
  windowManager = windows

  const exportSaver = new ExportArtifactSaver({
    exportService,
    dialog,
    getOwnerWindow: () => windows.getMainWindow(),
    getDocumentsPath: () => app.getPath('documents'),
    onError: (code, error) => console.error('[Electron] Export failed:', code, error)
  })

  const appCommands = new DesktopAppCommands({
    stopDeviceSessions,
    stopWorker: () => workerManager.stop(),
    closeDatabase: () => localData.closeDatabase(),
    closeLog: () => startupLog.close(),
    deleteLocalDataFiles: () => localData.deleteFiles(),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
    relaunchProcess: () => app.relaunch(),
    exitProcess: (code) => app.exit(code)
  })

  registerAppLifecycle(app, {
    isMac,
    hasMainWindow: () => Boolean(windows.getMainWindow()),
    createMainWindow: () => windows.createMainWindow(),
    unregisterShortcuts: () => globalShortcut.unregisterAll(),
    closeDatabase: () => {
      localData.closeDatabase()
      void startupLog.close()
    },
    terminateWorker: () => workerManager.terminate(),
    stopWorker: () => workerManager.stop()
  })

  try {
    const database = localData.openDatabase()
    console.log('[Electron] Local database ready:', database.databasePath)
    startupLog.write(`Local database ready: ${database.databasePath}`)
  } catch (error) {
    const message = errorMessage(error)
    console.error('[Electron] Local database unavailable:', message)
    startupLog.write(`Local database unavailable: ${message}`)
  }

  try {
    await workerManager.start()
  } catch (error) {
    const message = errorMessage(error)
    console.error('[Electron] Platform Worker unavailable:', message)
    startupLog.write(`Platform Worker unavailable: ${message}`)
    workerManager.scheduleRestart()
  }

  startupLog.write('Creating main window...')
  windows.createMainWindow()
  startupLog.write('Main window created')

  registerUpdateNotifications(autoUpdater, windows)
  const ipcContext = {
    assertMainSender: (event: Electron.IpcMainInvokeEvent) => windows.assertMainSender(event),
    getDatabase: () => localData.getDatabase()
  }
  registerSettingsIpc(ipcContext)
  registerCompetitionIpc(ipcContext, competitionService)
  registerStageIpc(ipcContext, stageService)
  registerMatchIpc(ipcContext, competitionService, matchSession, stopDeviceSessions)
  registerQueryIpc(ipcContext)
  registerExportIpc(ipcContext, exportService, (buildArtifact) => exportSaver.save(buildArtifact))
  registerWindowIpc(windows)
  registerOverlayIpc(windows, () => matchSession.getStatus())
  registerPlatformIpc(ipcContext, workerManager)
  registerDeviceIpc(ipcContext, workerManager)
  registerShortcutIpc(windows, globalShortcut)
  registerAppIpc(windows, {
    deleteLocalData: () => appCommands.deleteLocalData(),
    restartForUpdate: () => appCommands.restartForUpdate(),
    relaunch: () => appCommands.relaunch()
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
