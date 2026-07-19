import { defineStore } from 'pinia'

export const useReplayStore = defineStore('replay', {
  actions: {
    async fetchReportData(competitionId) {
      try {
        if (!window.ftEngine?.reports) throw new Error('LOCAL_REPORTS_UNAVAILABLE')
        return await window.ftEngine.reports.get(competitionId)
      } catch (error) {
        console.error('Fetch report failed', error)
        return null
      }
    },

    async fetchReplayData(competitionId, groupName, contestantName) {
      try {
        if (!window.ftEngine?.replay) throw new Error('LOCAL_REPLAY_UNAVAILABLE')
        return await window.ftEngine.replay.get(competitionId, groupName, contestantName)
      } catch (error) {
        console.error('Fetch replay failed', error)
        return null
      }
    },

    async exportScoreDetails(sourceKey, groupName, players, options) {
      try {
        if (!window.ftEngine?.exports) throw new Error('LOCAL_EXPORTS_UNAVAILABLE')
        return await window.ftEngine.exports.saveDetails({
          scope: {
            sourceKey,
            groupNames: [groupName],
            contestantNames: players
          },
          includeCsv: Boolean(options.txt),
          includeSrt: Boolean(options.srt),
          srtMode: options.srt_mode
        })
      } catch (error) {
        console.error('Export failed', error)
        return { status: 'error', error: 'EXPORT_WRITE_FAILED' }
      }
    },

    async exportReport(sourceKey, groupName, options) {
      try {
        if (!window.ftEngine?.exports) throw new Error('LOCAL_EXPORTS_UNAVAILABLE')
        return await window.ftEngine.exports.saveReport({
          sourceKey,
          groupName,
          view: options.view,
          scaleRatio: options.scaleRatio,
          includePenalty: options.includePenalty
        })
      } catch (error) {
        console.error('Report export failed', error)
        return { status: 'error', error: 'EXPORT_WRITE_FAILED' }
      }
    }
  }
})
