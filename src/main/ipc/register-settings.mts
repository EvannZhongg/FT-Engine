import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import { requireDatabase, type IpcRegistrationContext } from './context.mts'

export function registerSettingsIpc(context: IpcRegistrationContext): void {
  ipcMain.handle(IPC_CHANNELS.settings.get, (event) => {
    context.assertMainSender(event)
    return requireDatabase(context.getDatabase).getAppSettings()
  })

  ipcMain.handle(IPC_CHANNELS.settings.set, (event, key, value) => {
    context.assertMainSender(event)
    return requireDatabase(context.getDatabase).setAppSetting(key, value)
  })
}
