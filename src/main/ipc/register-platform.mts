import { ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  type PlatformWorkerRetryResult
} from '../../shared/ipc-contract.ts'
import type { IpcRegistrationContext } from './context.mts'

interface WorkerRequester {
  request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>
  retry(): Promise<{ status: 'ready' | 'already_ready'; hello?: unknown }>
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

  ipcMain.handle(
    IPC_CHANNELS.platform.retryWorker,
    async (event): Promise<PlatformWorkerRetryResult> => {
      context.assertMainSender(event)
      try {
        const result = await worker.retry()
        return { ok: true, status: result.status }
      } catch (error) {
        return { ok: false, status: 'error', error: stableErrorCode(error) }
      }
    }
  )
}

function stableErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = error.code
    if (typeof code === 'string' && code) return code
  }
  return 'WORKER_RETRY_FAILED'
}
