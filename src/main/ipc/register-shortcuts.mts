import { ipcMain } from 'electron'
import { IPC_CHANNELS, type ShortcutRegistrationResult } from '../../shared/ipc-contract.ts'
import type { DesktopWindowManager } from '../app/windows.mts'

interface ShortcutRegistry {
  register(shortcut: string, callback: () => void): boolean
  unregisterAll(): void
}

export function registerShortcutIpc(
  windows: DesktopWindowManager,
  shortcuts: ShortcutRegistry
): void {
  ipcMain.handle(
    IPC_CHANNELS.shortcuts.register,
    (event, shortcut: unknown): ShortcutRegistrationResult => {
      windows.assertMainSender(event)
      shortcuts.unregisterAll()

      if (typeof shortcut !== 'string' || shortcut.length < 1 || shortcut.length > 64) {
        return { ok: false, error: 'SHORTCUT_INVALID' }
      }

      try {
        const registered = shortcuts.register(shortcut, () => {
          console.log('[Electron] Global shortcut triggered:', shortcut)
          windows.sendToMain(IPC_CHANNELS.shortcuts.triggered)
        })
        if (!registered) {
          console.log('[Electron] Global shortcut registration failed')
          return { ok: false, error: 'SHORTCUT_UNAVAILABLE' }
        }
        return { ok: true }
      } catch (error) {
        console.error('[Electron] Error registering shortcut:', error)
        return { ok: false, error: 'SHORTCUT_INVALID' }
      }
    }
  )

  ipcMain.on(IPC_CHANNELS.shortcuts.unregister, (event) => {
    if (
      windows.rejectUnexpectedSender(
        event,
        windows.getMainWindow(),
        IPC_CHANNELS.shortcuts.unregister
      )
    ) {
      return
    }
    shortcuts.unregisterAll()
    console.log('[Electron] Global shortcuts unregistered')
  })
}
