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
    scoredPlayers: new Set()
  }),

  actions: {
    clearLocalState() {
      this.referees = {}
      this.currentContext = { groupName: '', contestantName: '' }
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

    async setMatchContext(groupName, contestantName) {
      if (this.matchActive) {
        if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
        await window.ftEngine.match.setContext(groupName, contestantName)
      }
      this.currentContext = { groupName, contestantName }
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

    async saveMediaBinding(groupName, contestantName, url) {
      if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
      const binding = await window.ftEngine.match.setMediaBinding(groupName, contestantName, url)
      const competitionStore = useCompetitionStore()
      if (!competitionStore.projectConfig.media) competitionStore.projectConfig.media = {}
      if (!competitionStore.projectConfig.media[groupName]) {
        competitionStore.projectConfig.media[groupName] = {}
      }
      competitionStore.projectConfig.media[groupName][contestantName] = binding
      return binding
    },

    async syncMediaPlayback(playback) {
      try {
        if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
        await window.ftEngine.match.syncPlayback(playback)
      } catch (error) {
        console.debug('Playback sync failed', error)
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
