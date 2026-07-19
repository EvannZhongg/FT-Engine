import { defineStore } from 'pinia'

const initialSettings = () => ({
  language: 'zh',
  theme: 'light',
  reset_shortcut: 'Ctrl+G',
  suppress_reset_confirm: false,
  suppress_zero_confirm: false,
  device_remarks: {},
  obs_protect_main: false,
  project_preferences: {}
})

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    appSettings: initialSettings(),
    loaded: false,
    errorCode: null
  }),

  actions: {
    async fetchSettings() {
      try {
        if (!window.ftEngine?.settings) throw new Error('LOCAL_SETTINGS_UNAVAILABLE')
        const settings = await window.ftEngine.settings.get()
        this.appSettings = { ...this.appSettings, ...settings }
        this.loaded = true
        this.errorCode = null
      } catch (error) {
        this.errorCode = error instanceof Error ? error.message : 'SETTINGS_READ_FAILED'
        console.error('Failed to fetch settings:', error)
      }
      return this.appSettings
    },

    async updateSetting(key, value) {
      const previous = this.appSettings[key]
      this.appSettings[key] = value
      try {
        if (!window.ftEngine?.settings) throw new Error('LOCAL_SETTINGS_UNAVAILABLE')
        this.appSettings = await window.ftEngine.settings.set(key, value)
        this.errorCode = null
        return true
      } catch (error) {
        this.appSettings[key] = previous
        this.errorCode = error instanceof Error ? error.message : 'SETTINGS_WRITE_FAILED'
        console.error('Failed to update setting:', error)
        return false
      }
    },

    async saveDeviceRemark(deviceId, remark) {
      const remarks = { ...(this.appSettings.device_remarks || {}), [deviceId]: remark }
      const saved = await this.updateSetting('device_remarks', remarks)
      if (!saved) throw new Error('DEVICE_REMARK_SAVE_FAILED')
      return true
    },

    getProjectPreference(competitionId, key, defaultValue = null) {
      const preferences = this.appSettings.project_preferences || {}
      return preferences[competitionId]?.[key] ?? defaultValue
    },

    async updateProjectPreference(competitionId, key, value) {
      if (!competitionId) return false
      const preferences = { ...(this.appSettings.project_preferences || {}) }
      preferences[competitionId] = { ...(preferences[competitionId] || {}), [key]: value }
      return this.updateSetting('project_preferences', preferences)
    },

    async removeProjectPreferences(competitionId) {
      if (!this.appSettings.project_preferences?.[competitionId]) return true
      const preferences = { ...this.appSettings.project_preferences }
      delete preferences[competitionId]
      return this.updateSetting('project_preferences', preferences)
    }
  }
})
