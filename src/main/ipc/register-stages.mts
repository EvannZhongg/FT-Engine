import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract.ts'
import type { StageService } from '../application/competitions/stage-service.mts'
import type { IpcRegistrationContext } from './context.mts'

export function registerStageIpc(context: IpcRegistrationContext, stages: StageService): void {
  ipcMain.handle(IPC_CHANNELS.stages.list, (event, competitionId) => {
    context.assertMainSender(event)
    return stages.list(competitionId)
  })

  ipcMain.handle(IPC_CHANNELS.stages.create, (event, competitionId, input) => {
    context.assertMainSender(event)
    return stages.create(competitionId, input)
  })

  ipcMain.handle(IPC_CHANNELS.stages.update, (event, stageId, input) => {
    context.assertMainSender(event)
    return stages.update(stageId, input)
  })

  ipcMain.handle(IPC_CHANNELS.stages.reorder, (event, competitionId, stageIds) => {
    context.assertMainSender(event)
    return stages.reorder(competitionId, stageIds)
  })

  ipcMain.handle(IPC_CHANNELS.stages.delete, (event, stageId) => {
    context.assertMainSender(event)
    return stages.delete(stageId)
  })

  ipcMain.handle(IPC_CHANNELS.stages.activate, (event, stageId) => {
    context.assertMainSender(event)
    return stages.activate(stageId)
  })

  ipcMain.handle(IPC_CHANNELS.stages.complete, (event, stageId) => {
    context.assertMainSender(event)
    return stages.complete(stageId)
  })

  ipcMain.handle(
    IPC_CHANNELS.stages.appendFreeContestant,
    (event, stageId, groupName, contestantName) => {
      context.assertMainSender(event)
      return stages.appendFreeContestant(stageId, groupName, contestantName)
    }
  )
}
