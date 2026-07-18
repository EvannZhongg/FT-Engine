import { defineStore } from 'pinia'

let finalizeMatchPromise = null
let platformWorkerRetryPromise = null
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

export const useRefereeStore = defineStore('referee', {
  state: () => ({
    referees: {},
    matchActive: false,
    matchStatus: initialMatchStatus(),
    projectConfig: { name: '', mode: 'FREE', groups: [] },
    stages: [],
    activeStageId: '',
    activeAttemptNumber: 1,
    currentContext: { groupName: '', contestantName: '' },
    appSettings: {
      language: 'zh',
      reset_shortcut: 'Ctrl+G',
      suppress_reset_confirm: false,
      suppress_zero_confirm: false,
      device_remarks: {},
      obs_protect_main: false,
      project_preferences: {}
    },
    scoredPlayers: new Set()
  }),

  getters: {
    activeStage: (state) => state.stages.find((stage) => stage.id === state.activeStageId) || null,
    activeGroups() {
      return this.activeStage?.groups || []
    }
  },

  actions: {
    updateScore(payload) {
      const { index, name, mode, score, status } = payload
      if (!this.referees[index]) {
        this.referees[index] = { name: `Referee ${index}` }
      }
      this.referees[index] = {
        ...this.referees[index],
        name: name || this.referees[index].name,
        mode: mode || this.referees[index].mode,
        total: score.total,
        plus: score.plus,
        minus: score.minus,
        penalty: score.penalty || 0, // 【新增】同步重点扣分
        status: status
      }
    },

    // 【新增】更新裁判名称 (用于 SetupWizard 修改名称并持久化)
    updateRefereeName(index, name) {
      // 1. 更新实时状态中的名称 (如果当前有实时状态)
      if (this.referees[index]) {
        this.referees[index].name = name
      }
      // 2. 更新项目配置中的名称 (如果已加载项目配置)
      // 这确保 SetupWizard 读取到更新后的值，并在 save/start 时包含新名称
      if (this.projectConfig && Array.isArray(this.projectConfig.referees)) {
        const refConfig = this.projectConfig.referees.find((r) => r.index === index)
        if (refConfig) {
          refConfig.name = name
        }
      }
    },

    // --- 2. 全局设置管理 ---
    async fetchSettings() {
      try {
        if (!window.ftEngine?.settings) throw new Error('LOCAL_SETTINGS_UNAVAILABLE')
        const settings = await window.ftEngine.settings.get()
        this.appSettings = { ...this.appSettings, ...settings }
      } catch (e) {
        console.error('Failed to fetch settings:', e)
      }
    },

    async updateSetting(key, value) {
      const previous = this.appSettings[key]
      this.appSettings[key] = value
      try {
        if (!window.ftEngine?.settings) throw new Error('LOCAL_SETTINGS_UNAVAILABLE')
        this.appSettings = await window.ftEngine.settings.set(key, value)
        return true
      } catch (e) {
        this.appSettings[key] = previous
        console.error('Failed to update setting:', e)
        return false
      }
    },

    // 【新增】保存设备备注
    async saveDeviceRemark(address, remark) {
      const remarks = { ...(this.appSettings.device_remarks || {}) }
      remarks[address] = remark
      const saved = await this.updateSetting('device_remarks', remarks)
      if (!saved) throw new Error('DEVICE_REMARK_SAVE_FAILED')
      return true
    },

    getProjectPreference(dirName, key, defaultValue = null) {
      const prefs = this.appSettings.project_preferences || {}
      return prefs[dirName]?.[key] ?? defaultValue
    },

    async updateProjectPreference(dirName, key, value) {
      if (!dirName) return
      const preferences = { ...(this.appSettings.project_preferences || {}) }
      preferences[dirName] = { ...(preferences[dirName] || {}), [key]: value }
      return this.updateSetting('project_preferences', preferences)
    },

    async renameDevices(devices) {
      try {
        if (!window.ftEngine?.devices) throw new Error('LOCAL_DEVICES_UNAVAILABLE')
        return await window.ftEngine.devices.rename(
          devices.map((device) => ({
            deviceId: device.address,
            name: device.name
          }))
        )
      } catch (e) {
        console.error('Rename devices failed:', e)
        throw e
      }
    },

    // --- 3. 项目与组别管理 API ---

    // 【新增】清理本地配置 (用于 New Match)
    clearLocalConfig() {
      this.projectConfig = { name: '', mode: 'FREE', groups: [] }
      this.stages = []
      this.activeStageId = ''
      this.activeAttemptNumber = 1
      this.currentContext = { groupName: '', contestantName: '' }
      this.scoredPlayers = new Set()
      this.referees = {}
      // App settings are independent from the active competition.
    },

    // 创建项目
    async createProject(name, mode) {
      try {
        if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
        this.projectConfig = await window.ftEngine.projects.create(name, mode)
        await this.fetchStages()
        return { status: 'ok', config: this.projectConfig }
      } catch (e) {
        console.error('Create Project Failed:', e)
        throw e
      }
    },

    // 更新组别信息 (赛事模式编辑完组别后调用)
    async updateGroups(groups) {
      if (this.activeStageId) {
        return this.updateActiveStageGroups(groups)
      }
      try {
        if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
        this.projectConfig = await window.ftEngine.projects.update(this.projectConfig.id, {
          name: this.projectConfig.name,
          mode: this.projectConfig.mode,
          groups
        })
      } catch (e) {
        console.error('Update Groups Failed:', e)
        throw e
      }
    },

    async updateProjectDetails(name, mode, groups = null) {
      if (!window.ftEngine?.projects || !this.projectConfig.id) {
        throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
      }
      const firstStage = this.stages[0]
      this.projectConfig = await window.ftEngine.projects.update(this.projectConfig.id, {
        name,
        mode,
        groups: groups || firstStage?.groups || this.projectConfig.groups
      })
      return this.projectConfig
    },

    async fetchStages(competitionId = this.projectConfig.id) {
      if (!competitionId) {
        this.stages = []
        this.activeStageId = ''
        this.activeAttemptNumber = 1
        return []
      }
      if (!window.ftEngine?.stages) throw new Error('LOCAL_STAGES_UNAVAILABLE')
      this.stages = await window.ftEngine.stages.list(competitionId)
      const selected =
        this.stages.find((stage) => stage.id === this.activeStageId) ||
        this.stages.find((stage) => stage.status === 'active') ||
        this.stages[0] ||
        null
      this.selectStage(selected?.id || '', this.activeAttemptNumber)
      return this.stages
    },

    selectStage(stageId, attemptNumber = 1) {
      const stage = this.stages.find((item) => item.id === stageId) || null
      this.activeStageId = stage?.id || ''
      this.activeAttemptNumber = stage
        ? Math.min(stage.attempts, Math.max(1, Number(attemptNumber) || 1))
        : 1
      if (stage) this.projectConfig.groups = stage.groups
      return stage
    },

    async createStage(input) {
      if (!window.ftEngine?.stages || !this.projectConfig.id) {
        throw new Error('LOCAL_STAGES_UNAVAILABLE')
      }
      const created = await window.ftEngine.stages.create(this.projectConfig.id, input)
      this.stages.push(created)
      return created
    },

    async updateStage(stageId, input) {
      if (!window.ftEngine?.stages) throw new Error('LOCAL_STAGES_UNAVAILABLE')
      const updated = await window.ftEngine.stages.update(stageId, input)
      const index = this.stages.findIndex((stage) => stage.id === stageId)
      if (index >= 0) this.stages.splice(index, 1, updated)
      if (this.activeStageId === stageId) this.selectStage(stageId, this.activeAttemptNumber)
      return updated
    },

    async updateActiveStageGroups(groups) {
      const stage = this.activeStage
      if (!stage) throw new Error('STAGE_NOT_SELECTED')
      return this.updateStage(stage.id, {
        name: stage.name,
        attempts: stage.attempts,
        groups
      })
    },

    async reorderStages(stageIds) {
      if (!window.ftEngine?.stages || !this.projectConfig.id) {
        throw new Error('LOCAL_STAGES_UNAVAILABLE')
      }
      this.stages = await window.ftEngine.stages.reorder(this.projectConfig.id, stageIds)
      this.selectStage(this.activeStageId, this.activeAttemptNumber)
      return this.stages
    },

    async deleteStage(stageId) {
      if (!window.ftEngine?.stages) throw new Error('LOCAL_STAGES_UNAVAILABLE')
      const deleted = await window.ftEngine.stages.delete(stageId)
      if (deleted) {
        this.stages = this.stages.filter((stage) => stage.id !== stageId)
        if (this.activeStageId === stageId) {
          this.selectStage(this.stages[0]?.id || '', 1)
        }
      }
      return deleted
    },

    async activateStage(stageId) {
      if (!window.ftEngine?.stages) throw new Error('LOCAL_STAGES_UNAVAILABLE')
      const updated = await window.ftEngine.stages.activate(stageId)
      await this.fetchStages()
      return updated
    },

    async completeStage(stageId) {
      if (!window.ftEngine?.stages) throw new Error('LOCAL_STAGES_UNAVAILABLE')
      const updated = await window.ftEngine.stages.complete(stageId)
      await this.fetchStages()
      return updated
    },

    // 设置当前比赛上下文 (切换选手/组别时调用)
    async setMatchContext(groupName, contestantName) {
      try {
        if (this.matchActive) {
          if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
          await window.ftEngine.match.setContext(groupName, contestantName)
        }
        this.currentContext.groupName = groupName
        this.currentContext.contestantName = contestantName
      } catch (e) {
        console.error('Set Context Failed:', e)
        throw e
      }
    },

    // --- 4. 设备扫描与绑定 ---

    async scanDevices(isRefresh = false) {
      try {
        if (!window.ftEngine?.devices) return []
        const result = await window.ftEngine.devices.scan({
          flush: Boolean(isRefresh),
          remarks: this.appSettings.device_remarks || {}
        })
        if (result.errors?.length) {
          console.warn('Scan warnings:', result.errors)
          if (!result.devices?.length) {
            throw new Error(result.errors.map((error) => error.code).join(', '))
          }
        }
        return result.devices || []
      } catch (e) {
        console.error('Scan failed:', e)
        throw e
      }
    },

    retryPlatformWorker() {
      if (platformWorkerRetryPromise) return platformWorkerRetryPromise
      const pending = (async () => {
        if (!window.ftEngine?.platform) throw new Error('LOCAL_PLATFORM_UNAVAILABLE')
        const result = await window.ftEngine.platform.retryWorker()
        if (!result?.ok) {
          const error = new Error(result?.error || 'WORKER_RETRY_FAILED')
          error.code = result?.error || 'WORKER_RETRY_FAILED'
          throw error
        }
        return result
      })().finally(() => {
        if (platformWorkerRetryPromise === pending) platformWorkerRetryPromise = null
      })
      platformWorkerRetryPromise = pending
      return pending
    },

    // 启动比赛：发送设备绑定信息
    async startMatch(config) {
      try {
        if (finalizeMatchPromise) await finalizeMatchPromise
        // 重置本地状态
        this.referees = {}
        config.referees.forEach((r) => {
          this.referees[r.index] = {
            name: r.name || `Referee ${r.index}`,
            mode: r.mode, // 【新增】保存模式，用于 UI 判断是否显示扣分
            total: 0,
            plus: 0,
            minus: 0,
            penalty: 0,
            status: { pri: 'connecting', sec: r.mode === 'DUAL' ? 'connecting' : 'n/a' }
          }
        })
        if (window.ftEngine?.match) {
          const result = await window.ftEngine.match.start({
            sourceKey: this.projectConfig.id,
            stageId: this.activeStageId,
            groupName: this.currentContext.groupName,
            contestantName: this.currentContext.contestantName,
            attemptNumber: this.activeAttemptNumber,
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
        } else {
          throw new Error('LOCAL_MATCH_UNAVAILABLE')
        }
      } catch (e) {
        console.error('Setup failed:', e)
        await this.stopMatch()
        throw e
      }
    },

    // --- 5. 比赛控制 ---

    async resetAll() {
      try {
        if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
        await window.ftEngine.match.reset()
        // 乐观更新
        for (const key in this.referees) {
          this.referees[key].total = 0
          this.referees[key].plus = 0
          this.referees[key].minus = 0
        }
      } catch (e) {
        console.error('Reset failed:', e)
        throw e
      }
    },

    async finalizeMatch(command) {
      if (finalizeMatchPromise) return finalizeMatchPromise
      if (command !== 'stop' && command !== 'invalidate') {
        throw new Error('MATCH_FINALIZE_COMMAND_INVALID')
      }
      const pending = (async () => {
        let completed = false
        try {
          let result
          if (window.ftEngine?.match) {
            result =
              command === 'invalidate'
                ? await window.ftEngine.match.invalidate()
                : await window.ftEngine.match.stop()
          } else {
            result = {
              ok: true,
              worker: { status: 'skipped' },
              sessionFinalized: true
            }
          }
          completed = result.sessionFinalized !== false
          if (!result.ok) console.warn('Some device owners did not stop cleanly', result)
          return result
        } catch (e) {
          console.error(`${command} match failed:`, e)
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
            this.referees = {}
            this.currentContext = { groupName: '', contestantName: '' }
          }
        }
      })().finally(() => {
        if (finalizeMatchPromise === pending) finalizeMatchPromise = null
      })
      finalizeMatchPromise = pending
      return pending
    },

    async stopMatch() {
      return this.finalizeMatch('stop')
    },

    async invalidateMatch() {
      return this.finalizeMatch('invalidate')
    },

    // --- 6. 窗口管理 (Overlay) ---

    // 获取系统窗口列表
    async fetchWindows() {
      try {
        if (!window.ftEngine?.platform) return []
        const result = await window.ftEngine.platform.listWindows()
        return result.windows || []
      } catch (e) {
        console.error('Failed to fetch windows:', e)
        return []
      }
    },

    // 获取特定窗口坐标
    async getWindowBounds(windowId) {
      try {
        if (!window.ftEngine?.platform) return { found: false, bounds: null }
        return await window.ftEngine.platform.getWindowBounds(windowId)
      } catch {
        return { found: false, bounds: null }
      }
    },

    // --- 7. 历史记录与报表 ---

    async fetchHistoryProjects() {
      try {
        if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
        return await window.ftEngine.projects.list()
      } catch (e) {
        console.error('Fetch projects failed', e)
        return []
      }
    },

    async loadProject(dirName) {
      try {
        if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
        const config = await window.ftEngine.projects.get(dirName)
        if (!config) return false
        this.projectConfig = config
        await this.fetchStages(config.id)
        return true
      } catch (e) {
        console.error('Load project failed', e)
        return false
      }
    },

    async fetchReportData(dirName) {
      try {
        if (!window.ftEngine?.reports) throw new Error('LOCAL_REPORTS_UNAVAILABLE')
        return await window.ftEngine.reports.get(dirName)
      } catch (e) {
        console.error('Fetch report failed', e)
        return null
      }
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
      this.matchActive =
        this.matchStatus.state === 'starting' || this.matchStatus.state === 'active'
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
      if (!this.projectConfig.media) this.projectConfig.media = {}
      if (!this.projectConfig.media[groupName]) this.projectConfig.media[groupName] = {}
      this.projectConfig.media[groupName][contestantName] = binding
      return binding
    },

    async syncMediaPlayback(playback) {
      try {
        if (!window.ftEngine?.match) throw new Error('LOCAL_MATCH_UNAVAILABLE')
        await window.ftEngine.match.syncPlayback(playback)
      } catch (e) {
        console.debug('Playback sync failed', e)
      }
    },

    async fetchReplayData(dirName, groupName, contestantName) {
      try {
        if (!window.ftEngine?.replay) throw new Error('LOCAL_REPLAY_UNAVAILABLE')
        return await window.ftEngine.replay.get(dirName, groupName, contestantName)
      } catch (e) {
        console.error('Fetch replay failed', e)
        return null
      }
    },

    // --- 8. 状态同步 (打分进度) ---

    async fetchScoredPlayers(groupName) {
      if (!groupName) return
      try {
        if (!window.ftEngine?.match || !this.projectConfig.id) {
          throw new Error('LOCAL_MATCH_UNAVAILABLE')
        }
        if (!this.activeStageId) throw new Error('STAGE_NOT_SELECTED')
        const scored = await window.ftEngine.match.listScored(
          this.projectConfig.id,
          this.activeStageId,
          groupName,
          this.activeAttemptNumber
        )
        this.scoredPlayers = new Set(scored)
      } catch (e) {
        console.error('Fetch status failed', e)
      }
    },

    broadcastPlayerScored(name) {
      this.markAsScored(name)
    },

    // 标记选手已完成 (本地更新)
    markAsScored(contestantName) {
      if (contestantName) {
        this.scoredPlayers.add(contestantName)
      }
    },

    // 清除标记 (用于覆盖重打)
    clearScoredStatus(contestantName) {
      if (contestantName) {
        this.scoredPlayers.delete(contestantName)
      }
    },
    // --- 新增：删除项目 ---
    async deleteProject(dirName) {
      try {
        if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
        const deleted = await window.ftEngine.projects.delete(dirName)
        if (deleted && this.appSettings.project_preferences) {
          const preferences = { ...this.appSettings.project_preferences }
          delete preferences[dirName]
          const preferencesUpdated = await this.updateSetting('project_preferences', preferences)
          if (!preferencesUpdated) {
            console.error('Project deleted but preference cleanup failed')
          }
        }
        return deleted
      } catch (e) {
        console.error('Delete project failed', e)
        return false
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
      } catch (e) {
        console.error('Export failed', e)
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
      } catch (e) {
        console.error('Report export failed', e)
        return { status: 'error', error: 'EXPORT_WRITE_FAILED' }
      }
    }
  }
})
