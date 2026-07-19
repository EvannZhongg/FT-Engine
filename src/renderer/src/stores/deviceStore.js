import { defineStore } from 'pinia'
import { useSettingsStore } from './settingsStore'

let platformWorkerRetryPromise = null

export const useDeviceStore = defineStore('devices', {
  state: () => ({
    scanStatus: 'idle',
    workerStatus: 'idle',
    errorCode: null
  }),

  actions: {
    async scanDevices(isRefresh = false) {
      this.scanStatus = 'scanning'
      try {
        if (!window.ftEngine?.devices) throw new Error('LOCAL_DEVICES_UNAVAILABLE')
        const settingsStore = useSettingsStore()
        // Pinia state is reactive; clone the bounded string map before crossing
        // the Electron structured-clone boundary.
        const remarks = Object.fromEntries(
          Object.entries(settingsStore.appSettings.device_remarks || {})
        )
        const result = await window.ftEngine.devices.scan({
          flush: Boolean(isRefresh),
          remarks
        })
        if (result.errors?.length && !result.devices?.length) {
          const firstError = result.errors[0]
          const error = new Error(firstError.message || firstError.code || 'Device scan failed')
          error.code = firstError.code || 'DEVICE_SCAN_FAILED'
          error.retryable = firstError.retryable !== false
          throw error
        }
        if (result.errors?.length) console.warn('Scan warnings:', result.errors)
        this.scanStatus = 'ready'
        this.errorCode = null
        return result.devices || []
      } catch (error) {
        this.scanStatus = 'error'
        this.errorCode = error instanceof Error && typeof error.code === 'string'
          ? error.code
          : 'DEVICE_SCAN_FAILED'
        console.error('Scan failed:', error)
        throw error
      }
    },

    async renameDevices(devices) {
      if (!window.ftEngine?.devices) throw new Error('LOCAL_DEVICES_UNAVAILABLE')
      return window.ftEngine.devices.rename(
        devices.map((device) => ({ deviceId: device.address, name: device.name }))
      )
    },

    retryPlatformWorker() {
      if (platformWorkerRetryPromise) return platformWorkerRetryPromise
      this.workerStatus = 'reconnecting'
      const pending = (async () => {
        if (!window.ftEngine?.platform) throw new Error('LOCAL_PLATFORM_UNAVAILABLE')
        const result = await window.ftEngine.platform.retryWorker()
        if (!result?.ok) {
          const error = new Error(result?.error || 'WORKER_RETRY_FAILED')
          error.code = result?.error || 'WORKER_RETRY_FAILED'
          throw error
        }
        this.workerStatus = 'ready'
        this.errorCode = null
        return result
      })()
        .catch((error) => {
          this.workerStatus = 'error'
          this.errorCode = error instanceof Error && typeof error.code === 'string'
            ? error.code
            : 'WORKER_RETRY_FAILED'
          throw error
        })
        .finally(() => {
          if (platformWorkerRetryPromise === pending) platformWorkerRetryPromise = null
        })
      platformWorkerRetryPromise = pending
      return pending
    },

    async fetchWindows() {
      try {
        if (!window.ftEngine?.platform) return []
        const result = await window.ftEngine.platform.listWindows()
        return result.windows || []
      } catch (error) {
        console.error('Failed to fetch windows:', error)
        return []
      }
    },

    async getWindowBounds(windowId) {
      try {
        if (!window.ftEngine?.platform) return { found: false, bounds: null }
        return await window.ftEngine.platform.getWindowBounds(windowId)
      } catch {
        return { found: false, bounds: null }
      }
    }
  }
})
