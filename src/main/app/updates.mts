import { IPC_CHANNELS } from '../../shared/ipc-contract.ts'

interface UpdateEventSource {
  on(event: 'update-available' | 'update-downloaded', listener: () => void): unknown
}

interface UpdateEventTarget {
  sendToMain(channel: string): void
}

export function registerUpdateNotifications(
  updates: UpdateEventSource,
  target: UpdateEventTarget
): void {
  updates.on('update-available', () => {
    target.sendToMain(IPC_CHANNELS.app.updateAvailable)
  })
  updates.on('update-downloaded', () => {
    target.sendToMain(IPC_CHANNELS.app.updateDownloaded)
  })
}
