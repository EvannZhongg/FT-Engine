import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import { requireDatabase, type IpcRegistrationContext } from './context.mts'

export function registerQueryIpc(context: IpcRegistrationContext): void {
  ipcMain.handle(IPC_CHANNELS.replay.get, (event, sourceKey, groupName, contestantName) => {
    context.assertMainSender(event)
    for (const value of [sourceKey, groupName, contestantName]) {
      if (typeof value !== 'string' || !value || value.length > 256) {
        throw new Error('IPC_INVALID_REPLAY_CONTEXT')
      }
    }
    return requireDatabase(context.getDatabase).getReplay(sourceKey, groupName, contestantName)
  })

  ipcMain.handle(IPC_CHANNELS.reports.get, (event, sourceKey) => {
    context.assertMainSender(event)
    if (typeof sourceKey !== 'string' || !sourceKey || sourceKey.length > 256) {
      throw new Error('IPC_INVALID_REPORT_CONTEXT')
    }
    return requireDatabase(context.getDatabase).getReport(sourceKey)
  })
}
