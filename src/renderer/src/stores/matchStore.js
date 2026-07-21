import { defineStore } from 'pinia'
import { useCompetitionStore } from './competitionStore'

let finalizeMatchPromise = null
let removeMatchRefereeListener = () => {}
let removeMatchContextListener = () => {}
let removeMatchStatusListener = () => {}
let matchListenersConnected = false

const initialMatchStatus = () => ({
  state: 'idle',
  persistence: 'idle',
  worker: 'idle',
  media: 'not_ready',
  errorCode: null,
  lastSavedAt: null
})

export const useMatchStore = defineStore('match', {
  state: () => ({
    referees: {},
    matchActive: false,
    matchStatus: initialMatchStatus(),
    currentContext: { groupName: '', contestantName: '' },
    activePlayback: null,
    scoredPlayers: new Set()
  }),

  actions: {
    clearLocalState() {
      this.referees = {}
      this.currentContext = { groupName: '', contestantName: '' }
      this.activePlayback = null
      this.scoredPlayers = new Set()
    },

    updateScore(payload) {
      const { index, name, mode, score, status } = payload
      const previous = this.referees[index] || { name: `Referee ${index}` }
      this.referees[index] = {
        ...previous,
        name: name || previous.name,
        mode: mode || previous.mode,
        total: score.total,
        plus: score.plus,
        minus: score.minus,
        penalty: score.penalty || 0,
        status
      }
    },

    async transitionMatchContext(groupName, contestantName, binding, progressMode = 'reset') {
      if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
      const result = await window.ftEngine.match.transitionContext({
        group_name: groupName,
        contestant_name: contestantName,
        binding_version_id: binding?.version_id || null,
        progress_mode: progressMode,
        expected_media_key: binding
          ? `${binding.provider}:${binding.media_id}:${binding.segment}`
          : null
      })
      this.currentContext = { groupName: result.group_name, contestantName: result.contestant_name }
      this.activePlayback =
        result.binding && result.playback_session_id
          ? {
              playback_session_id: result.playback_session_id,
              binding_version_id: result.binding.version_id,
              binding: result.binding,
              progress_mode: result.progress_mode,
              continuity_position_ms: result.continuity_position_ms
            }
          : null
      return result
    },

    async startMatch(config) {
      if (finalizeMatchPromise) await finalizeMatchPromise
      const competitionStore = useCompetitionStore()
      try {
        this.referees = {}
        config.referees.forEach((referee) => {
          this.referees[referee.index] = {
            name: referee.name || `Referee ${referee.index}`,
            mode: referee.mode,
            total: 0,
            plus: 0,
            minus: 0,
            penalty: 0,
            status: {
              pri: 'connecting',
              sec: referee.mode === 'DUAL' ? 'connecting' : 'n/a'
            }
          }
        })
        if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
        const result = await window.ftEngine.match.start({
          sourceKey: competitionStore.projectConfig.id,
          stageId: competitionStore.activeStageId,
          groupName: this.currentContext.groupName,
          contestantName: this.currentContext.contestantName,
          attemptNumber: competitionStore.activeAttemptNumber,
          referees: config.referees.map((referee) => ({
            index: referee.index,
            name: referee.name || `Referee ${referee.index}`,
            mode: referee.mode,
            primaryDeviceId: referee.primaryDeviceId || null,
            secondaryDeviceId: referee.mode === 'DUAL' ? referee.secondaryDeviceId || null : null
          }))
        })
        this.matchStatus = result.status
        this.matchActive = result.status.state === 'active'
      } catch (error) {
        console.error('Setup failed:', error)
        await this.stopMatch()
        throw error
      }
    },

    async resetAll() {
      if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
      await window.ftEngine.match.reset()
      for (const referee of Object.values(this.referees)) {
        referee.total = 0
        referee.plus = 0
        referee.minus = 0
      }
    },

    async finalizeMatch(command) {
      if (finalizeMatchPromise) return finalizeMatchPromise
      if (!['stop', 'invalidate'].includes(command)) {
        throw new Error('MATCH_FINALIZE_COMMAND_INVALID')
      }
      const pending = (async () => {
        let completed = false
        try {
          const result = window.ftEngine?.match
            ? await window.ftEngine.match[command === 'invalidate' ? 'invalidate' : 'stop']()
            : { ok: true, worker: { status: 'skipped' }, sessionFinalized: true }
          completed = result.sessionFinalized !== false
          if (!result.ok) console.warn('Some device owners did not stop cleanly', result)
          return result
        } catch (error) {
          console.error(`${command} match failed:`, error)
          return {
            ok: false,
            worker: {
              status: 'error',
              error: command === 'invalidate' ? 'MATCH_INVALIDATE_FAILED' : 'MATCH_STOP_FAILED'
            },
            sessionFinalized: false
          }
        } finally {
          if (completed) {
            this.matchActive = false
            if (!window.ftEngine?.match) this.matchStatus = initialMatchStatus()
            this.clearLocalState()
          }
        }
      })().finally(() => {
        if (finalizeMatchPromise === pending) finalizeMatchPromise = null
      })
      finalizeMatchPromise = pending
      return pending
    },

    stopMatch() {
      return this.finalizeMatch('stop')
    },

    invalidateMatch() {
      return this.finalizeMatch('invalidate')
    },

    async connectMatchEvents() {
      if (matchListenersConnected || !window.ftEngine?.match) return
      removeMatchRefereeListener = window.ftEngine.match.onRefereeUpdated((update) => {
        this.updateScore(update)
      })
      removeMatchContextListener = window.ftEngine.match.onContextUpdated((context) => {
        this.currentContext = context
      })
      removeMatchStatusListener = window.ftEngine.match.onStatusUpdated((status) => {
        this.matchStatus = status
        this.matchActive = status.state === 'starting' || status.state === 'active'
      })
      matchListenersConnected = true
      this.matchStatus = await window.ftEngine.match.getStatus()
      this.matchActive = ['starting', 'active'].includes(this.matchStatus.state)
    },

    disconnectMatchEvents() {
      removeMatchRefereeListener()
      removeMatchContextListener()
      removeMatchStatusListener()
      removeMatchRefereeListener = () => {}
      removeMatchContextListener = () => {}
      removeMatchStatusListener = () => {}
      matchListenersConnected = false
    },

    async parseMediaUrl(url) {
      if (!window.ftEngine?.media) throw new Error('LOCAL_MEDIA_UNAVAILABLE')
      return window.ftEngine.media.parseUrl(url)
    },

    async getMediaBinding(groupName, contestantName) {
      if (!window.ftEngine?.media) throw new Error('LOCAL_MEDIA_UNAVAILABLE')
      return window.ftEngine.media.getBinding(groupName, contestantName)
    },

    async saveMediaBinding(groupName, contestantName, url) {
      if (!window.ftEngine?.media) throw new Error('LOCAL_MEDIA_UNAVAILABLE')
      const binding = await window.ftEngine.media.replaceBinding(groupName, contestantName, url)
      const competitionStore = useCompetitionStore()
      if (!competitionStore.projectConfig.media) competitionStore.projectConfig.media = {}
      if (!competitionStore.projectConfig.media[groupName]) {
        competitionStore.projectConfig.media[groupName] = {}
      }
      competitionStore.projectConfig.media[groupName][contestantName] = binding
      return binding
    },

    async removeMediaBinding(groupName, contestantName) {
      if (!window.ftEngine?.media) throw new Error('LOCAL_MEDIA_UNAVAILABLE')
      await window.ftEngine.media.removeBinding(groupName, contestantName)
      const competitionStore = useCompetitionStore()
      delete competitionStore.projectConfig.media?.[groupName]?.[contestantName]
      if (
        this.currentContext.groupName === groupName &&
        this.currentContext.contestantName === contestantName
      ) {
        this.activePlayback = null
      }
    },

    async beginMediaPlayback(binding) {
      if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
      const playback = await window.ftEngine.match.beginPlayback(binding.version_id)
      this.activePlayback = {
        ...playback,
        progress_mode: 'reset',
        continuity_position_ms: null
      }
      return this.activePlayback
    },

    async syncMediaPlayback(playback) {
      try {
        if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
        return await window.ftEngine.match.syncPlayback(playback)
      } catch (error) {
        console.debug('Playback sync failed', error)
        return null
      }
    },

    async reportMediaPlayerError(error) {
      const playback = this.activePlayback
      if (!playback || !window.ftEngine?.match) return null
      try {
        return await window.ftEngine.match.reportMediaError({
          playback_session_id: playback.playback_session_id,
          binding_version_id: playback.binding_version_id,
          code: String(error?.code || 'MEDIA_PLAYER_UNAVAILABLE')
        })
      } catch (reportError) {
        console.debug('Playback error report was rejected', reportError)
        return null
      }
    },

    async fetchScoredPlayers(groupName) {
      if (!groupName) return
      const competitionStore = useCompetitionStore()
      try {
        if (!window.ftEngine?.match || !competitionStore.projectConfig.id) {
          throw new Error('LOCAL_MATCH_UNAVAILABLE')
        }
        if (!competitionStore.activeStageId) throw new Error('STAGE_NOT_SELECTED')
        const scored = await window.ftEngine.match.listScored(
          competitionStore.projectConfig.id,
          competitionStore.activeStageId,
          groupName,
          competitionStore.activeAttemptNumber
        )
        this.scoredPlayers = new Set(scored)
      } catch (error) {
        console.error('Fetch status failed', error)
      }
    },

    broadcastPlayerScored(contestantName) {
      if (contestantName) this.scoredPlayers.add(contestantName)
    },

    clearScoredStatus(contestantName) {
      if (contestantName) this.scoredPlayers.delete(contestantName)
    }
  }
})
