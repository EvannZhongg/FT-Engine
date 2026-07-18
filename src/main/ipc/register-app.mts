import { ipcMain } from 'electron'
import { IPC_CHANNELS, type DeleteLocalDataResult } from '../../shared/ipc-contract.ts'
import type { DesktopWindowManager } from '../app/windows.mts'

type DeleteResult = Omit<DeleteLocalDataResult, 'ok'>

interface AppIpcActions {
  deleteLocalData: () => Promise<DeleteResult>
  restartForUpdate: () => Promise<void>
  relaunch: () => void
}

export function registerAppIpc(
  windows: DesktopWindowManager,
  actions: AppIpcActions,
  schedule: (callback: () => void, delayMs: number) => unknown = setTimeout
): void {
  ipcMain.on(IPC_CHANNELS.app.restartForUpdate, async (event) => {
    if (
      windows.rejectUnexpectedSender(
        event,
        windows.getMainWindow(),
        IPC_CHANNELS.app.restartForUpdate
      )
    ) {
      return
    }
    await actions.restartForUpdate()
  })

  ipcMain.handle(
    IPC_CHANNELS.app.deleteLocalData,
    async (event): Promise<DeleteLocalDataResult> => {
      windows.assertMainSender(event)
      const result = await actions.deleteLocalData()
      if (result.failed.length > 0) return { ok: false, ...result }

      schedule(actions.relaunch, 150)
      return { ok: true, ...result }
    }
  )
}
