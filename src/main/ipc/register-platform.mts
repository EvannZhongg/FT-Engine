import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract.ts'
import type { IpcRegistrationContext } from './context.mts'

interface WorkerRequester {
  request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>
}

export function registerPlatformIpc(context: IpcRegistrationContext, worker: WorkerRequester): void {
  ipcMain.handle(IPC_CHANNELS.platform.listWindows, async (event) => {
    context.assertMainSender(event)
    return worker.request('window.list')
  })

  ipcMain.handle(IPC_CHANNELS.platform.getWindowBounds, async (event, windowId: unknown) => {
    context.assertMainSender(event)
    if (typeof windowId !== 'string' || !windowId || windowId.length > 128) {
      throw new Error('IPC_INVALID_WINDOW_ID')
    }
    return worker.request('window.getBounds', { windowId })
  })
}
