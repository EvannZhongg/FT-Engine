import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract.ts'
import type { IpcRegistrationContext } from './context.mts'
import { createDeviceScanFailure, normalizeDeviceScanResult } from './device-scan-dto.mts'

interface WorkerRequester {
  request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>
}

export function registerDeviceIpc(context: IpcRegistrationContext, worker: WorkerRequester): void {
  ipcMain.handle(IPC_CHANNELS.devices.scan, async (event, value: unknown) => {
    context.assertMainSender(event)
    const options = isRecord(value) ? value : {}
    const flush = options.flush === true
    const rawRemarks = isRecord(options.remarks) ? options.remarks : {}
    const entries = Object.entries(rawRemarks)
    if (entries.length > 1000) throw new Error('IPC_INVALID_DEVICE_REMARKS')
    const remarks: Record<string, string> = {}
    for (const [deviceId, remark] of entries) {
      if (deviceId.length > 256 || typeof remark !== 'string' || remark.length > 256) {
        throw new Error('IPC_INVALID_DEVICE_REMARKS')
      }
      remarks[deviceId] = remark
    }
    try {
      return normalizeDeviceScanResult(
        await worker.request('device.scan', { flush, remarks }, flush ? 8000 : 5000)
      )
    } catch (error) {
      return createDeviceScanFailure(errorCode(error, 'WORKER_SCAN_FAILED'))
    }
  })

  ipcMain.handle(IPC_CHANNELS.devices.rename, async (event, value: unknown) => {
    context.assertMainSender(event)
    if (!Array.isArray(value) || value.length > 100) {
      throw new Error('IPC_INVALID_DEVICE_RENAME')
    }
    return Promise.all(
      value.map(async (item: unknown) => {
        if (
          !isRecord(item) ||
          typeof item.deviceId !== 'string' ||
          !item.deviceId ||
          item.deviceId.length > 128 ||
          typeof item.name !== 'string' ||
          !item.name.trim() ||
          Buffer.byteLength(item.name.trim(), 'utf8') > 32
        ) {
          return {
            deviceId: isRecord(item) ? String(item.deviceId || '') : '',
            name: isRecord(item) ? String(item.name || '') : '',
            status: 'error',
            error: 'INVALID_PARAMS'
          }
        }
        const deviceId = item.deviceId
        const name = item.name.trim()
        try {
          await worker.request('device.renameDiscovered', { deviceId, name }, 15000)
          return { deviceId, name, status: 'ok' }
        } catch (error) {
          return {
            deviceId,
            name,
            status: 'error',
            error: errorCode(error, 'DEVICE_RENAME_FAILED')
          }
        }
      })
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorCode(error: unknown, fallback: string): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : fallback
}
