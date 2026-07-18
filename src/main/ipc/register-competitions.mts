import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { CompetitionService } from '../application/competitions/competition-service.mts'
import type { IpcRegistrationContext } from './context.mts'

export function registerCompetitionIpc(
  context: IpcRegistrationContext,
  competitionService: CompetitionService
): void {
  ipcMain.handle(IPC_CHANNELS.projects.create, (event, projectName, mode) => {
    context.assertMainSender(event)
    return competitionService.create(projectName, mode)
  })

  ipcMain.handle(IPC_CHANNELS.projects.update, (event, sourceKey, input) => {
    context.assertMainSender(event)
    return competitionService.update(sourceKey, input)
  })

  ipcMain.handle(IPC_CHANNELS.projects.get, (event, sourceKey) => {
    context.assertMainSender(event)
    return competitionService.get(sourceKey)
  })

  ipcMain.handle(IPC_CHANNELS.projects.list, (event) => {
    context.assertMainSender(event)
    return competitionService.list()
  })

  ipcMain.handle(IPC_CHANNELS.projects.delete, (event, sourceKey) => {
    context.assertMainSender(event)
    return competitionService.delete(sourceKey)
  })
}
