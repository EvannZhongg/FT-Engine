// src/renderer/src/stores/refereeStore.js
import { defineStore } from 'pinia'
import axios from 'axios'

const API_BASE = 'http://127.0.0.1:8000'

export const useRefereeStore = defineStore('referee', {
  state: () => ({
    referees: {}, // 结构: { 1: { total: 0, plus: 0, minus: 0, name: "..." } }
    isConnected: false,
    ws: null
  }),

  actions: {
    // 初始化 WebSocket 连接
    connectWebSocket() {
      if (this.ws) return

      this.ws = new WebSocket('ws://127.0.0.1:8000/ws')

      this.ws.onopen = () => {
        this.isConnected = true
        console.log('WS Connected')
      }

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'score_update') {
          this.updateScore(msg.payload)
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
      // payload: { index: 1, total: 10, plus: 10, minus: 0 }
      const { index, total, plus, minus } = payload
      if (!this.referees[index]) {
        this.referees[index] = { total: 0, plus: 0, minus: 0 }
      }
      this.referees[index] = { ...this.referees[index], total, plus, minus }
    },

    // 调用 Python 接口：扫描设备
    async scanDevices() {
      const res = await axios.get(`${API_BASE}/scan`)
      return res.data.devices // 返回 [{name: 'Counter-xx', address: '...'}]
    },

    // 调用 Python 接口：配置裁判
    async setupReferees(config) {
      // config 结构需匹配 server.py 的要求
      await axios.post(`${API_BASE}/setup`, config)

      // 本地状态也初始化一下
      config.referees.forEach(r => {
        this.referees[r.index] = {
          name: r.name, total: 0, plus: 0, minus: 0
        }
      })
    },

    // 调用 Python 接口：重置
    async resetAll() {
      await axios.post(`${API_BASE}/reset`)
      // 前端可以先乐观更新 UI
      for (const key in this.referees) {
        this.referees[key].total = 0
        this.referees[key].plus = 0
        this.referees[key].minus = 0
      }
    }
  }
})
