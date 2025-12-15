import {defineStore} from 'pinia'
import axios from 'axios'

export const useRefereeStore = defineStore('referee', {
  state: () => ({
    // --- 动态配置 ---
    apiBase: 'http://127.0.0.1:8000', // 默认值，会被 initConfig 覆盖
    wsUrl: 'ws://127.0.0.1:8000/ws',  // 默认值

    // 裁判与设备状态
    referees: {},
    isConnected: false,
    ws: null,

    // 项目配置
    projectConfig: {name: '', mode: 'FREE', groups: []},
    // 当前比赛上下文
    currentContext: {groupName: '', contestantName: ''},

    // 全局用户配置
    appSettings: {
      language: 'zh',
      suppress_reset_confirm: false
    },

    // 本地维护已打分选手集合 (用于智能跳转下一位)
    scoredPlayers: new Set()
  }),

  actions: {
    // --- 新增：初始化配置 (从 Electron 获取端口) ---
    async initConfig() {
      // 检查是否在 Electron 环境下
      if (window.electron && window.electron.ipcRenderer) {
        try {
          // 调用主进程接口获取 config.yaml 中的端口
          const config = await window.electron.ipcRenderer.invoke('get-server-config')
          const port = config.port

          // 更新 API 地址
          this.apiBase = `http://127.0.0.1:${port}`
          this.wsUrl = `ws://127.0.0.1:${port}/ws`
          console.log(`[Store] Configured API to port ${port}`)
        } catch (e) {
          console.error("Failed to load server config", e)
        }
      }
    },

    // --- 1. WebSocket 连接 ---
    async connectWebSocket() {
      // 1. 确保配置已加载 (获取正确端口)
      await this.initConfig()

      if (this.ws) return

      // 2. 使用动态的 wsUrl 连接
      this.ws = new WebSocket(this.wsUrl)

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
          // 【新增】监听分组列表更新
          else if (msg.type === 'groups_update') {
            // 直接更新本地的项目配置中的 groups
            if (this.projectConfig) {
              this.projectConfig.groups = msg.payload.groups
            }
          }
        } catch (e) {
          console.error("WS Message Parse Error", e)
        }
      }

      this.ws.onclose = () => {
        this.isConnected = false
        this.ws = null
        // 断线重连
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

    // --- 2. 全局设置管理 ---
    async fetchSettings() {
      try {
        // 使用 this.apiBase
        const res = await axios.get(`${this.apiBase}/api/settings`)
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
        await axios.post(`${this.apiBase}/api/settings/update`, payload)
      } catch (e) {
        console.error("Failed to update setting:", e)
      }
    },

    // --- 3. 项目与组别管理 API ---

    // 【新增】清理本地配置 (用于 New Match)
    clearLocalConfig() {
      this.projectConfig = {name: '', mode: 'FREE', groups: []}
      this.currentContext = {groupName: '', contestantName: ''}
      this.scoredPlayers = new Set()
      this.referees = {}
      // 注意：不重置 appSettings 和 ws 连接
    },

    // 创建项目
    async createProject(name, mode) {
      try {
        const res = await axios.post(`${this.apiBase}/api/project/create`, {name, mode})
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
        await axios.post(`${this.apiBase}/api/project/update_groups`, {groups})
        this.projectConfig.groups = groups
      } catch (e) {
        console.error("Update Groups Failed:", e)
        throw e
      }
    },

    // 设置当前比赛上下文 (切换选手/组别时调用)
    async setMatchContext(groupName, contestantName) {
      try {
        await axios.post(`${this.apiBase}/api/match/set_context`, {
          group: groupName,
          contestant: contestantName
        })
        this.currentContext.groupName = groupName
        this.currentContext.contestantName = contestantName
      } catch (e) {
        console.error("Set Context Failed:", e)
      }
    },

    // --- 4. 设备扫描与绑定 ---

    async scanDevices(isRefresh = false) {
      try {
        const res = await axios.get(`${this.apiBase}/scan?flush=${isRefresh}`)
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
        await axios.post(`${this.apiBase}/setup`, config)

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

    // --- 5. 比赛控制 ---

    async resetAll() {
      try {
        await axios.post(`${this.apiBase}/reset`)
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
        await axios.post(`${this.apiBase}/teardown`)
      } catch (e) {
        console.error("Stop match failed:", e)
      } finally {
        this.referees = {}
        this.currentContext = {groupName: '', contestantName: ''}
      }
    },

    // --- 6. 窗口管理 (Overlay) ---

    // 获取系统窗口列表
    async fetchWindows() {
      try {
        const res = await axios.get(`${this.apiBase}/api/windows`)
        return res.data.windows || []
      } catch (e) {
        console.error("Failed to fetch windows:", e)
        return []
      }
    },

    // 获取特定窗口坐标
    async getWindowBounds(title) {
      try {
        const res = await axios.post(`${this.apiBase}/api/window/bounds`, {title})
        return res.data
      } catch (e) {
        return {found: false}
      }
    },

    // --- 7. 历史记录与报表 ---

    async fetchHistoryProjects() {
      try {
        const res = await axios.get(`${this.apiBase}/api/projects/list`)
        return res.data.projects || []
      } catch (e) {
        console.error("Fetch projects failed", e)
        return []
      }
    },

    async loadProject(dirName) {
      try {
        const res = await axios.post(`${this.apiBase}/api/project/load`, {dir_name: dirName})
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
        const res = await axios.post(`${this.apiBase}/api/project/report`, {dir_name: dirName})
        return res.data
      } catch (e) {
        console.error("Fetch report failed", e)
        return null
      }
    },

    // --- 8. 状态同步 (打分进度) ---

    async fetchScoredPlayers(groupName) {
      if (!groupName) return
      try {
        const res = await axios.post(`${this.apiBase}/api/group/status`, {group: groupName})
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
    },
    // --- 新增：删除项目 ---
    async deleteProject(dirName) {
      try {
        const res = await axios.post(`${this.apiBase}/api/project/delete`, {dir_name: dirName})
        return res.data.status === 'ok'
      } catch (e) {
        console.error("Delete project failed", e)
        return false
      }
    },
    async exportScoreDetails(groupName, players, options) {
      try {
        const response = await axios.post(`${this.apiBase}/api/export/details`, {
          group: groupName,
          players: players,
          options: options
        }, {
          responseType: 'blob' // 关键：接收二进制流
        })

        // 触发浏览器下载
        const url = window.URL.createObjectURL(new Blob([response.data]))
        const link = document.createElement('a')
        link.href = url

        // 尝试从 header 获取文件名，或者自己生成
        const contentDisposition = response.headers['content-disposition']
        let fileName = `Export_${groupName}.zip`
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="?([^"]+)"?/)
          if (match && match[1]) fileName = match[1]
        }

        link.setAttribute('download', fileName)
        document.body.appendChild(link)
        link.click()
        link.remove()

        return true
      } catch (e) {
        console.error("Export failed", e)
        return false
      }
    }
  }
})
