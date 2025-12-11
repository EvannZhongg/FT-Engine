import {defineStore} from 'pinia'
import axios from 'axios'

const API_BASE = 'http://127.0.0.1:8000'

export const useRefereeStore = defineStore('referee', {
  state: () => ({
    referees: {},
    isConnected: false,
    ws: null,

    projectConfig: {name: '', mode: 'FREE', groups: []},
    currentContext: {groupName: '', contestantName: ''},

    // 全局用户配置
    appSettings: {
      language: 'zh',
      suppress_reset_confirm: false
    },
    scoredPlayers: new Set() // 本地维护已打分选手集合
  }),

  actions: {
    // --- 1. WebSocket 连接 ---
    connectWebSocket() {
      if (this.ws) return
      this.ws = new WebSocket('ws://127.0.0.1:8000/ws')
      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('WS Connected')
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          // 监听分数更新、状态更新、以及上下文更新(同步多端)
          if (msg.type === 'score_update' || msg.type === 'status_update') {
            this.updateScore(msg.payload)
          } else if (msg.type === 'context_update') {
            this.currentContext.groupName = msg.payload.group
            this.currentContext.contestantName = msg.payload.contestant
          }
        } catch (e) {
          console.error("WS Message Parse Error", e)
        }
      }

      this.ws.onclose = () => {
        this.isConnected = false
        this.ws = null
        setTimeout(() => this.connectWebSocket(), 3000)
      }
    },

    updateScore(payload) {
      const {index, score, status} = payload
      // 确保对象存在
      if (!this.referees[index]) {
        this.referees[index] = {name: `Referee ${index}`}
      }
      this.referees[index] = {
        ...this.referees[index],
        total: score.total,
        plus: score.plus,
        minus: score.minus,
        status: status
      }
    },

    async fetchSettings() {
      try {
        const res = await axios.get(`${API_BASE}/api/settings`)
        // 合并到本地状态
        this.appSettings = {...this.appSettings, ...res.data}
      } catch (e) {
        console.error("Failed to fetch settings:", e)
      }
    },

    async updateSetting(key, value) {
      try {
        const payload = {}
        payload[key] = value
        // 乐观更新本地状态
        this.appSettings[key] = value
        // 发送给后端保存
        await axios.post(`${API_BASE}/api/settings/update`, payload)
      } catch (e) {
        console.error("Failed to update setting:", e)
      }
    },
    // --- 2. 项目与组别管理 API ---

    // 创建项目
    async createProject(name, mode) {
      try {
        const res = await axios.post(`${API_BASE}/api/project/create`, {name, mode})
        // 后端返回初始配置
        this.projectConfig = res.data.config
        return res.data
      } catch (e) {
        console.error("Create Project Failed:", e)
        throw e
      }
    },

    // 更新组别信息 (赛事模式编辑完组别后调用)
    async updateGroups(groups) {
      try {
        await axios.post(`${API_BASE}/api/project/update_groups`, {groups})
        this.projectConfig.groups = groups
      } catch (e) {
        console.error("Update Groups Failed:", e)
        throw e
      }
    },

    // 设置当前比赛上下文 (切换选手/组别时调用)
    async setMatchContext(groupName, contestantName) {
      try {
        await axios.post(`${API_BASE}/api/match/set_context`, {
          group: groupName,
          contestant: contestantName
        })
        this.currentContext.groupName = groupName
        this.currentContext.contestantName = contestantName
      } catch (e) {
        console.error("Set Context Failed:", e)
      }
    },

    // --- 3. 设备扫描与绑定 ---

    async scanDevices(isRefresh = false) {
      try {
        const res = await axios.get(`${API_BASE}/scan?flush=${isRefresh}`)
        return res.data.devices || []
      } catch (e) {
        console.error("Scan failed:", e)
        throw e
      }
    },

    // 启动比赛：发送设备绑定信息
    async startMatch(config) {
      try {
        // config: { referees: [...] }
        await axios.post(`${API_BASE}/setup`, config)

        // 重置本地状态
        this.referees = {}
        config.referees.forEach(r => {
          this.referees[r.index] = {
            name: r.name || `Referee ${r.index}`,
            total: 0, plus: 0, minus: 0,
            status: {pri: 'connecting', sec: r.mode === 'DUAL' ? 'connecting' : 'n/a'}
          }
        })
      } catch (e) {
        console.error("Setup failed:", e)
        throw e
      }
    },

    // --- 4. 比赛控制 ---

    async resetAll() {
      try {
        await axios.post(`${API_BASE}/reset`)
        // 乐观更新
        for (const key in this.referees) {
          this.referees[key].total = 0
          this.referees[key].plus = 0
          this.referees[key].minus = 0
        }
      } catch (e) {
        console.error("Reset failed:", e)
      }
    },

    async stopMatch() {
      try {
        await axios.post(`${API_BASE}/teardown`)
      } catch (e) {
        console.error("Stop match failed:", e)
      } finally {
        this.referees = {}
        this.currentContext = {groupName: '', contestantName: ''}
      }
    },
    // 获取系统窗口列表
    async fetchWindows() {
      try {
        const res = await axios.get(`${API_BASE}/api/windows`)
        return res.data.windows || []
      } catch (e) {
        console.error("Failed to fetch windows:", e)
        return []
      }
    },

    // 获取特定窗口坐标
    async getWindowBounds(title) {
      try {
        const res = await axios.post(`${API_BASE}/api/window/bounds`, {title})
        return res.data
      } catch (e) {
        return {found: false}
      }
    },
    // --- 5. 历史记录与报表 ---
    async fetchHistoryProjects() {
      try {
        const res = await axios.get(`${API_BASE}/api/projects/list`)
        return res.data.projects || []
      } catch (e) {
        console.error("Fetch projects failed", e)
        return []
      }
    },

    async loadProject(dirName) {
      try {
        const res = await axios.post(`${API_BASE}/api/project/load`, {dir_name: dirName})
        if (res.data.status === 'ok') {
          this.projectConfig = res.data.config
          return true
        }
        return false
      } catch (e) {
        console.error("Load project failed", e)
        return false
      }
    },

    async fetchReportData(dirName) {
      try {
        // 返回 { config: ..., scores: ... }
        const res = await axios.post(`${API_BASE}/api/project/report`, {dir_name: dirName})
        return res.data
      } catch (e) {
        console.error("Fetch report failed", e)
        return null
      }
    },
    // --- 6. 状态同步 ---

    async fetchScoredPlayers(groupName) {
      if (!groupName) return
      try {
        const res = await axios.post(`${API_BASE}/api/group/status`, {group: groupName})
        if (res.data.scored) {
          this.scoredPlayers = new Set(res.data.scored)
        }
      } catch (e) {
        console.error("Fetch status failed", e)
      }
    },

    // 标记选手已完成 (乐观更新)
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
    }
  }
})
