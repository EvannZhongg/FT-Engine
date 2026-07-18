import { ipcMain } from 'electron'
import { IPC_CHANNELS, type MatchStopResult } from '../../shared/ipc-contract'
import type { CompetitionService } from '../application/competitions/competition-service.mts'
import type { MatchSessionService, MatchStartInput } from '../match/match-session.mts'
import { requireDatabase, type IpcRegistrationContext } from './context.mts'

export function registerMatchIpc(
  context: IpcRegistrationContext,
  competitionService: CompetitionService,
  matchSession: MatchSessionService,
  stopDeviceSessions: (reason: string) => Promise<MatchStopResult>
): void {
  ipcMain.handle(IPC_CHANNELS.match.start, async (event, input) => {
    context.assertMainSender(event)
    requireDatabase(context.getDatabase)
    const sourceKey = input?.sourceKey
    const config = typeof sourceKey === 'string' ? competitionService.get(sourceKey) : null
    if (!config) throw new Error('MATCH_PROJECT_NOT_FOUND')
    return matchSession.start(input as MatchStartInput)
  })

  ipcMain.handle(IPC_CHANNELS.match.setContext, async (event, groupName, contestantName) => {
    context.assertMainSender(event)
    return matchSession.setContext(groupName, contestantName)
  })

  ipcMain.handle(IPC_CHANNELS.match.getStatus, (event) => {
    context.assertMainSender(event)
    return matchSession.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.match.syncPlayback, (event, playback) => {
    context.assertMainSender(event)
    if (!playback || typeof playback !== 'object' || Array.isArray(playback)) {
      throw new Error('IPC_INVALID_MATCH_PLAYBACK')
    }
    matchSession.updatePlayback(playback)
  })

  ipcMain.handle(IPC_CHANNELS.match.setMediaBinding, (event, groupName, contestantName, url) => {
    context.assertMainSender(event)
    return matchSession.setMediaBinding(groupName, contestantName, url)
  })

  ipcMain.handle(IPC_CHANNELS.match.listScored, (event, sourceKey, groupName) => {
    context.assertMainSender(event)
    if (
      typeof sourceKey !== 'string' ||
      !sourceKey ||
      sourceKey.length > 256 ||
      typeof groupName !== 'string' ||
      !groupName ||
      groupName.length > 256
    ) {
      throw new Error('IPC_INVALID_MATCH_CONTEXT')
    }
    return requireDatabase(context.getDatabase).listScoredContestants(sourceKey, groupName)
  })

  ipcMain.handle(IPC_CHANNELS.match.reset, async (event) => {
    context.assertMainSender(event)
    return matchSession.reset()
  })

  ipcMain.handle(IPC_CHANNELS.match.stop, async (event) => {
    context.assertMainSender(event)
    return stopDeviceSessions('score-page-exit')
  })
}
