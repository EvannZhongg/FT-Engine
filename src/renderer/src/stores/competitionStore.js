import { defineStore } from 'pinia'
import { useSettingsStore } from './settingsStore'

const emptyCompetition = () => ({ name: '', mode: 'FREE', groups: [] })

export const useCompetitionStore = defineStore('competitions', {
  state: () => ({
    projectConfig: emptyCompetition(),
    projects: [],
    stages: [],
    activeStageId: '',
    activeAttemptNumber: 1,
    listStatus: 'idle',
    errorCode: null
  }),

  getters: {
    activeStage: (state) => state.stages.find((stage) => stage.id === state.activeStageId) || null,
    activeGroups() {
      return this.activeStage?.groups || []
    }
  },

  actions: {
    clearLocalConfig() {
      this.projectConfig = emptyCompetition()
      this.stages = []
      this.activeStageId = ''
      this.activeAttemptNumber = 1
      this.errorCode = null
    },

    async createProject(name, mode) {
      if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
      this.projectConfig = await window.ftEngine.projects.create(name, mode)
      await this.fetchStages()
      return { status: 'ok', config: this.projectConfig }
    },

    async updateGroups(groups) {
      if (this.activeStageId) return this.updateActiveStageGroups(groups)
      if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
      this.projectConfig = await window.ftEngine.projects.update(this.projectConfig.id, {
        name: this.projectConfig.name,
        mode: this.projectConfig.mode,
        groups
      })
      return this.projectConfig
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
      return this.updateStage(stage.id, { name: stage.name, attempts: stage.attempts, groups })
    },

    async appendFreeContestant(groupName, contestantName) {
      const stage = this.activeStage
      if (!stage || !window.ftEngine?.stages) throw new Error('LOCAL_STAGES_UNAVAILABLE')
      const updated = await window.ftEngine.stages.appendFreeContestant(
        stage.id,
        groupName,
        contestantName
      )
      const index = this.stages.findIndex((item) => item.id === updated.id)
      if (index >= 0) this.stages.splice(index, 1, updated)
      this.selectStage(updated.id, this.activeAttemptNumber)
      return updated
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
        if (this.activeStageId === stageId) this.selectStage(this.stages[0]?.id || '', 1)
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

    async fetchHistoryProjects() {
      this.listStatus = 'loading'
      try {
        if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
        this.projects = await window.ftEngine.projects.list()
        this.listStatus = 'ready'
        this.errorCode = null
      } catch (error) {
        this.projects = []
        this.listStatus = 'error'
        this.errorCode = error instanceof Error ? error.message : 'PROJECT_LIST_FAILED'
        console.error('Fetch projects failed', error)
      }
      return this.projects
    },

    async loadProject(competitionId) {
      try {
        if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
        const config = await window.ftEngine.projects.get(competitionId)
        if (!config) return false
        this.projectConfig = config
        await this.fetchStages(config.id)
        return true
      } catch (error) {
        console.error('Load project failed', error)
        return false
      }
    },

    async deleteProject(competitionId) {
      try {
        if (!window.ftEngine?.projects) throw new Error('LOCAL_PROJECTS_UNAVAILABLE')
        const deleted = await window.ftEngine.projects.delete(competitionId)
        if (!deleted) return false
        this.projects = this.projects.filter((project) => project.id !== competitionId)
        const settingsStore = useSettingsStore()
        if (!(await settingsStore.removeProjectPreferences(competitionId))) {
          console.error('Project deleted but preference cleanup failed')
        }
        if (this.projectConfig.id === competitionId) this.clearLocalConfig()
        return true
      } catch (error) {
        console.error('Delete project failed', error)
        return false
      }
    }
  }
})
