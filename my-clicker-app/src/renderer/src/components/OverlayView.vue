<template>
  <div class="overlay-container">
    <div class="dock-trigger-zone" @mouseenter="onDockEnter" @mouseleave="onDockLeave">
      <div class="overlay-dock" :class="{ visible: isDockVisible || showSettings }">
        <div class="dock-content">
          <span class="dock-info">{{ store.currentContext.contestantName || 'Waiting...' }}</span>
          <button class="btn-dock" @click="changePlayer(1)" title="Next Player">Next ▶</button>
          <button class="btn-dock btn-dock-reset" @click="store.resetAll()" title="Reset Score">R</button>
          <button class="btn-dock" @click="toggleWaveform" :class="{ active: showWaveform }" title="Toggle Waveform">📈</button>
          <button class="btn-dock" @click="toggleSettings" :class="{ active: showSettings }" title="Settings">⚙️</button>
          <button class="btn-dock btn-dock-exit" @click="closeOverlay" title="Close Overlay">✖</button>
        </div>
      </div>
    </div>
    <div v-if="showSettings" class="settings-panel" @mouseenter="setIgnoreMouse(false)" @mouseleave="handleCardLeave">
      <h4>Overlay Settings</h4>
      <div class="setting-row">
        <label>Display Mode:</label>
        <select v-model="config.displayMode">
          <option value="SPLIT">Split (+ / -)</option>
          <option value="TOTAL">Total Only</option>
          <option value="COMBINED">Total & Split</option>
          <option value="REALTIME">Real-time (Burst)</option>
        </select>
      </div>
      <div class="setting-row">
        <label>Opacity:</label>
        <input type="range" v-model.number="config.opacity" min="0" max="1" step="0.05">
        <span>{{ Math.round(config.opacity * 100) }}%</span>
      </div>
      <div class="setting-row">
        <label>Bg Color:</label>
        <input type="color" v-model="config.color">
      </div>
      <div class="setting-actions">
        <button class="btn-reset-style" @click="resetStyle">Reset Default</button>
        <button class="btn-close-settings" @click="showSettings = false">Close</button>
      </div>
    </div>

    <div
      v-if="showWaveform"
      ref="waveformCardRef"
      class="score-card waveform-card draggable-card"
      :style="[getWaveformStyle(), cardStyle]"
      @mousedown="startDrag($event, 'waveform')"
      @mouseenter="setIgnoreMouse(false)"
      @mouseleave="handleCardLeave"
    >
      <WaveformWidget />
      <div class="resize-handle-visual"></div>
    </div>

    <div
      v-for="(ref, refKey) in store.referees"
      :key="refKey"
      class="score-card draggable-card"
      :style="[getCardStyle(refKey), cardStyle]"
      @mousedown="startDrag($event, refKey)"
      @mouseenter="setIgnoreMouse(false)"
      @mouseleave="handleCardLeave"
    >
      <div class="overlay-header">
         <span class="ref-label">{{ ref.name }}</span>
      </div>

      <div class="score-body">

        <div v-if="config.displayMode === 'SPLIT'" class="score-grid-row">
          <div class="grid-cell right-align">
            <span class="score-val plus">+{{ ref.plus }}</span>
          </div>
          <div class="grid-cell center-align">
            <span class="score-divider">/</span>
          </div>
          <div class="grid-cell left-align">
            <span class="score-val minus">-{{ ref.minus }}</span>
          </div>
        </div>

        <div v-else-if="config.displayMode === 'TOTAL'" class="score-single-row">
          <span class="score-val total">{{ ref.total }}</span>
        </div>

        <div v-else-if="config.displayMode === 'COMBINED'" class="score-combined-col">
          <div class="combined-total">{{ ref.total }}</div>
          <div class="combined-detail">
            <span class="mini-plus">+{{ ref.plus }}</span> / <span class="mini-minus">-{{ ref.minus }}</span>
          </div>
        </div>

        <div v-else-if="config.displayMode === 'REALTIME'" class="score-grid-row realtime-layout">
          <div class="grid-cell right-align fixed-slot">
            <transition name="pop">
              <span v-if="getRealTimeScore(refKey, 'plus') > 0" class="score-val plus rt-val">
                +{{ getRealTimeScore(refKey, 'plus') }}
              </span>
            </transition>
          </div>

          <div class="grid-cell center-align fixed-divider">
            <span class="score-divider">/</span>
          </div>

          <div class="grid-cell left-align fixed-slot">
            <transition name="pop">
              <span v-if="getRealTimeScore(refKey, 'minus') > 0" class="score-val minus rt-val">
                -{{ getRealTimeScore(refKey, 'minus') }}
              </span>
            </transition>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'
import WaveformWidget from './WaveformWidget.vue'

const store = useRefereeStore()
const GRID_SIZE = 20
const cardPositions = reactive({})
let draggingRefKey = null
let dragOffset = { x: 0, y: 0 }
let isDragging = false

const showWaveform = ref(true)
const showSettings = ref(false)
const isDockVisible = ref(false)
const waveformCardRef = ref(null)
let resizeObserver = null

const previousScores = {}
const realTimeData = reactive({})
const BURST_THRESHOLD = 400
const DISPLAY_DURATION = 1000

const defaultConfig = {
  opacity: 0.85,
  color: '#141414',
  displayMode: 'SPLIT'
}
const config = reactive({ ...defaultConfig })

const loadConfig = () => {
  const saved = localStorage.getItem('overlay_config_v2')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      Object.assign(config, parsed)
    } catch(e) {}
  }
}
watch(config, (newVal) => {
  localStorage.setItem('overlay_config_v2', JSON.stringify(newVal))
})
const resetStyle = () => Object.assign(config, defaultConfig)

const cardStyle = computed(() => {
  const hex = config.color
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${config.opacity})`,
    boxShadow: config.opacity < 0.1 ? 'none' : '2px 2px 10px rgba(0, 0, 0, 0.5)',
    borderLeftColor: config.opacity < 0.1 ? 'transparent' : '#3498db'
  }
})

watch(() => store.referees, (newRefs) => {
  Object.keys(newRefs).forEach(key => {
    const ref = newRefs[key]
    if (!previousScores[key]) {
      previousScores[key] = { plus: ref.plus, minus: ref.minus }
      return
    }
    const prev = previousScores[key]
    const deltaPlus = ref.plus - prev.plus
    const deltaMinus = ref.minus - prev.minus
    previousScores[key] = { plus: ref.plus, minus: ref.minus }
    if (deltaPlus > 0) processBurstScore(key, 'plus', deltaPlus)
    if (deltaMinus > 0) processBurstScore(key, 'minus', deltaMinus)
    if (ref.plus === 0 && ref.minus === 0) {
      clearRealTimeScore(key)
    }
  })
}, { deep: true })

const processBurstScore = (key, type, delta) => {
  if (!realTimeData[key]) {
    realTimeData[key] = {
      plus: { val: 0, lastTime: 0, timer: null },
      minus: { val: 0, lastTime: 0, timer: null }
    }
  }
  const slot = realTimeData[key][type]
  const now = Date.now()
  const timeDiff = now - slot.lastTime
  if (slot.val === 0 || timeDiff > BURST_THRESHOLD) {
    slot.val = delta
  } else {
    slot.val += delta
  }
  slot.lastTime = now
  if (slot.timer) clearTimeout(slot.timer)
  slot.timer = setTimeout(() => {
    slot.val = 0
  }, DISPLAY_DURATION)
}

const clearRealTimeScore = (key) => {
  if (realTimeData[key]) {
    realTimeData[key].plus.val = 0
    realTimeData[key].minus.val = 0
  }
}

const getRealTimeScore = (key, type) => {
  return realTimeData[key] ? realTimeData[key][type].val : 0
}

const onDockEnter = () => { isDockVisible.value = true; setIgnoreMouse(false) }
const onDockLeave = () => {
  if (!showSettings.value) isDockVisible.value = false
  if (!isDragging && !showSettings.value) setIgnoreMouse(true)
}
const toggleSettings = () => { showSettings.value = !showSettings.value }

if (window.electron) {
  window.electron.ipcRenderer.on('init-overlay-data', (event, data) => {
    if (data.referees) {
      store.referees = data.referees
      initCardPositions()
      Object.keys(data.referees).forEach(k => {
        if (data.referees[k]) {
           previousScores[k] = { plus: data.referees[k].plus, minus: data.referees[k].minus }
        }
      })
    }
    if (data.context) {
      store.currentContext = data.context
    }
    if (data.projectConfig) {
      store.projectConfig = data.projectConfig
    }
  })
}

watch(() => store.referees, () => { initCardPositions() }, { deep: true })
watch(showWaveform, (val) => {
  if (val) nextTick(() => setupResizeObserver())
  else if (resizeObserver) resizeObserver.disconnect()
})

const initCardPositions = () => {
  Object.keys(store.referees).forEach((refKey, idx) => {
    if (!cardPositions[refKey]) cardPositions[refKey] = { x: 20, y: 80 + (idx * 120) }
  })
  if (!cardPositions['waveform']) {
    const initW = 600
    const initH = 220
    const screenW = window.innerWidth
    const screenH = window.innerHeight
    cardPositions['waveform'] = { x: (screenW - initW) / 2, y: screenH - initH - 50, w: initW, h: initH }
  }
}

const setupResizeObserver = () => {
  if (waveformCardRef.value) {
    const saved = cardPositions['waveform']
    if (saved) {
      waveformCardRef.value.style.width = `${saved.w}px`
      waveformCardRef.value.style.height = `${saved.h}px`
    }
    resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (cardPositions['waveform']) {
          const newW = entry.target.offsetWidth
          const newH = entry.target.offsetHeight
          const oldW = cardPositions['waveform'].w
          const oldH = cardPositions['waveform'].h
          if (Math.abs(newW - oldW) > 2 || Math.abs(newH - oldH) > 2) {
             cardPositions['waveform'].w = newW
             cardPositions['waveform'].h = newH
          }
        }
      }
    })
    resizeObserver.observe(waveformCardRef.value)
  }
}

onMounted(() => {
  loadConfig()
  store.connectWebSocket()
  initCardPositions()
  setupResizeObserver()
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
  if (resizeObserver) resizeObserver.disconnect()
  if (window.electron) window.electron.ipcRenderer.removeAllListeners('init-overlay-data')
})

const closeOverlay = () => { if (window.electron) window.electron.ipcRenderer.send('close-overlay') }
const setIgnoreMouse = (ignore) => { if (window.electron) window.electron.ipcRenderer.send('set-ignore-mouse', ignore) }
const handleCardLeave = () => { if (!isDragging && !showSettings.value) setIgnoreMouse(true) }
const toggleWaveform = () => { showWaveform.value = !showWaveform.value }

const getWaveformStyle = () => {
  const pos = cardPositions['waveform'] || { x: 0, y: 0 }
  return { left: `${pos.x}px`, top: `${pos.y}px`, zIndex: draggingRefKey === 'waveform' ? 9999 : 1000, position: 'absolute' }
}

const getCardStyle = (key) => {
  const pos = cardPositions[key] || { x: 0, y: 0 }
  return { left: `${pos.x}px`, top: `${pos.y}px`, zIndex: draggingRefKey === key ? 9999 : 1000, position: 'absolute' }
}

const startDrag = (e, key) => {
  if (e.button !== 0) return
  const target = e.currentTarget.getBoundingClientRect()
  const isRightEdge = e.clientX - target.left > target.width - 25
  const isBottomEdge = e.clientY - target.top > target.height - 25
  if (key === 'waveform' && isRightEdge && isBottomEdge) return

  isDragging = true
  draggingRefKey = key
  setIgnoreMouse(false)
  const pos = cardPositions[key] || { x: 0, y: 0 }
  dragOffset = { x: e.clientX - pos.x, y: e.clientY - pos.y }
}

const onDrag = (e) => {
  if (!draggingRefKey) return
  let rawX = e.clientX - dragOffset.x
  let rawY = e.clientY - dragOffset.y
  const newPos = { x: Math.round(rawX / GRID_SIZE) * GRID_SIZE, y: Math.round(rawY / GRID_SIZE) * GRID_SIZE }
  const oldPos = cardPositions[draggingRefKey]
  if (oldPos && oldPos.w) { newPos.w = oldPos.w; newPos.h = oldPos.h }
  cardPositions[draggingRefKey] = newPos
}

const stopDrag = () => { isDragging = false; draggingRefKey = null }

// 【关键修改】 Overlay 端的切换选手逻辑，复刻 Free Mode 自动新建逻辑
const changePlayer = async (delta) => {
  const groupName = store.currentContext.groupName
  const group = store.projectConfig.groups.find(g => g.name === groupName)
  if (!group) return
  const currentIdx = group.players.indexOf(store.currentContext.contestantName)
  const nextIdx = currentIdx + delta

  // 如果是 Free Mode 且超出范围，自动新建
  if (nextIdx >= group.players.length && store.projectConfig.mode === 'FREE') {
      const newPlayerName = `Player ${group.players.length + 1}`
      group.players.push(newPlayerName)
      await store.updateGroups(store.projectConfig.groups)
      await store.setMatchContext(groupName, newPlayerName)
      await store.resetAll()
  } else if (group.players[nextIdx]) {
      // 正常切换
      await store.setMatchContext(groupName, group.players[nextIdx])
      await store.resetAll()
  }
}
</script>

<style scoped lang="scss">
/* Styles Omitted, assume unchanged */
.overlay-container { width: 100vw; height: 100vh; overflow: hidden; background: transparent; }
.dock-trigger-zone { position: absolute; top: 0; left: 0; width: 100%; height: 40px; z-index: 10000; display: flex; justify-content: center; }
.overlay-dock { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); transform: translateY(-100%); padding-top: 5px; &.visible { transform: translateY(0); } }
.dock-content { background: rgba(0, 0, 0, 0.85); padding: 6px 15px; border-radius: 0 0 10px 10px; display: flex; align-items: center; gap: 10px; color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
.dock-info { font-weight: bold; font-size: 0.9rem; margin-right: 5px; color: #ddd; }
.btn-dock { background: #444; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.9rem; transition: 0.2s; &.active { background: #3498db; } &:hover { filter: brightness(1.2); } }
.btn-dock-reset { background: #f39c12; }
.btn-dock-exit { background: #e74c3c; }

.settings-panel { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); background: #252526; border: 1px solid #444; padding: 15px; border-radius: 8px; z-index: 10001; color: white; width: 280px; box-shadow: 0 5px 20px rgba(0,0,0,0.5); h4 { margin: 0 0 15px 0; text-align: center; color: #ccc; } .setting-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; label { font-size: 0.9rem; color: #aaa; } input[type=range] { width: 100px; } input[type=color] { border: none; width: 40px; height: 25px; padding: 0; background: none; } select { background: #333; color: white; border: 1px solid #555; padding: 2px 5px; border-radius: 4px; width: 140px; } span { width: 40px; text-align: right; font-size: 0.85rem; } } .setting-actions { display: flex; justify-content: space-between; margin-top: 15px; button { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; } .btn-reset-style { background: #555; color: white; } .btn-close-settings { background: #3498db; color: white; } } }

.score-card { color: white; border-left: 4px solid #3498db; padding: 10px; cursor: grab; user-select: none; display: flex; flex-direction: column; transition: background-color 0.2s, box-shadow 0.2s; &:active { cursor: grabbing; border-color: #2ecc71; } }
.score-card:not(.waveform-card) { width: 180px; }
.waveform-card { resize: both; overflow: hidden; min-width: 200px; min-height: 100px; padding: 0; padding-left: 5px; transform: translateZ(0); backface-visibility: hidden; }
.resize-handle-visual { position: absolute; bottom: 2px; right: 2px; width: 12px; height: 12px; border-right: 3px solid #666; border-bottom: 3px solid #666; pointer-events: none; opacity: 0.6; }

.overlay-header { font-size: 0.85rem; color: #aaa; border-bottom: 1px solid #444; margin-bottom: 5px; padding-bottom: 2px; }
.score-body { display: flex; align-items: center; justify-content: center; min-height: 40px; width: 100%; }

.score-grid-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; width: 100%; }
.grid-cell { white-space: nowrap; }
.left-align { text-align: left; }
.center-align { text-align: center; }
.right-align { text-align: right; }
.fixed-slot { min-height: 32px; display: flex; align-items: center; }
.fixed-slot.right-align { justify-content: flex-end; }
.fixed-slot.left-align { justify-content: flex-start; }

.score-val { font-size: 2rem; font-weight: bold; line-height: 1; &.plus { color: #fff; } &.minus { color: #ff6b6b; } &.total { font-size: 2.5rem; color: #2ecc71; } }
.score-divider { font-size: 1.5rem; color: #666; margin: 0 5px; font-weight: lighter; }
.score-combined-col { display: flex; flex-direction: column; align-items: center; }
.combined-total { font-size: 2rem; font-weight: bold; color: #2ecc71; line-height: 1; margin-bottom: 2px; }
.combined-detail { font-size: 0.9rem; color: #bbb; .mini-plus { color: #ddd; } .mini-minus { color: #ff6b6b; } }
.pop-enter-active, .pop-leave-active { transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(0.5); }
</style>
