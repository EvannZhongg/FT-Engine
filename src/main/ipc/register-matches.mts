import { ipcMain } from 'electron'
import { IPC_CHANNELS, type MatchStopResult } from '../../shared/ipc-contract'
import type { CompetitionService } from '../application/competitions/competition-service.mts'
import { resolveAndNormalizeMediaUrl } from '../../shared/media/normalize-media-url.mts'
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

  ipcMain.handle(IPC_CHANNELS.match.transitionContext, async (event, input) => {
    context.assertMainSender(event)
    return matchSession.transitionContext(input)
  })

  ipcMain.handle(IPC_CHANNELS.match.beginPlayback, (event, bindingVersionId) => {
    context.assertMainSender(event)
    return matchSession.beginPlayback(bindingVersionId)
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
    return matchSession.updatePlayback(playback)
  })

  ipcMain.handle(IPC_CHANNELS.match.mediaError, (event, input) => {
    context.assertMainSender(event)
    return matchSession.reportMediaError(input)
  })

  ipcMain.handle(IPC_CHANNELS.media.parseUrl, async (event, url) => {
    context.assertMainSender(event)
    return resolveAndNormalizeMediaUrl(url)
  })

  ipcMain.handle(IPC_CHANNELS.media.getBinding, (event, groupName, contestantName) => {
    context.assertMainSender(event)
    return matchSession.getMediaBinding(groupName, contestantName)
  })

  ipcMain.handle(
    IPC_CHANNELS.media.replaceBinding,
    async (event, groupName, contestantName, url) => {
      context.assertMainSender(event)
      const parsed = await resolveAndNormalizeMediaUrl(url)
      return matchSession.replaceMediaBinding(groupName, contestantName, parsed)
    }
  )

  ipcMain.handle(IPC_CHANNELS.media.removeBinding, (event, groupName, contestantName) => {
    context.assertMainSender(event)
    return matchSession.removeMediaBinding(groupName, contestantName)
  })

  ipcMain.handle(
    IPC_CHANNELS.match.listScored,
    (event, sourceKey, stageId, groupName, attemptNumber) => {
      context.assertMainSender(event)
      if (
        typeof sourceKey !== 'string' ||
        !sourceKey ||
        sourceKey.length > 256 ||
        typeof stageId !== 'string' ||
        !stageId ||
        stageId.length > 128 ||
        typeof groupName !== 'string' ||
        !groupName ||
        groupName.length > 256 ||
        !Number.isSafeInteger(attemptNumber) ||
        attemptNumber < 1 ||
        attemptNumber > 20
      ) {
        throw new Error('IPC_INVALID_MATCH_CONTEXT')
      }
      return requireDatabase(context.getDatabase).listScoredContestants(
        sourceKey,
        stageId,
        groupName,
        attemptNumber
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.match.reset, async (event) => {
    context.assertMainSender(event)
    return matchSession.reset()
  })

  ipcMain.handle(IPC_CHANNELS.match.stop, async (event) => {
    context.assertMainSender(event)
    matchSession.completeCurrent()
    return { ...(await stopDeviceSessions('score-page-exit')), sessionFinalized: true }
  })

  ipcMain.handle(IPC_CHANNELS.match.invalidate, async (event) => {
    context.assertMainSender(event)
    matchSession.invalidateCurrent()
    return { ...(await stopDeviceSessions('invalidate-session')), sessionFinalized: true }
  })
}
