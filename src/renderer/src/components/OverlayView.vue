<template>
  <div class="overlay-container" @click.self="handleBackgroundClick">
    <div
      class="dock-trigger-zone"
      :style="getDockZoneStyle()"
      @mouseenter="onDockEnter"
      @mouseleave="onDockLeave"
    >
      <div class="overlay-dock" :class="{ visible: isDockVisible || showSettings }">
        <div class="dock-content" @mousedown="startDrag($event, 'dock')">
          <span class="dock-info" :title="store.currentContext.contestantName">
            {{ store.currentContext.contestantName || $t('ov_contestant_waiting') }}
          </span>

          <button class="btn-dock" :disabled="contextChangePending" @click="changePlayer(1)" :title="$t('ov_btn_next')">Next ▶</button>
          <button class="btn-dock btn-dock-reset" :disabled="contextChangePending" @click="store.resetAll()" :title="$t('ov_btn_reset')">R</button>
          <button class="btn-dock" @click="toggleWaveform" :class="{ active: showWaveform }" :title="$t('ov_btn_wave')">📈</button>
          <button class="btn-dock" @click="toggleSettings" :class="{ active: showSettings }" :title="$t('ov_btn_settings')">⚙️</button>
          <button class="btn-dock btn-dock-exit" @click="closeOverlay" :title="$t('ov_btn_close')">✖</button>
        </div>
      </div>

      <div v-if="showSettings" class="settings-panel" @mouseenter="setIgnoreMouse(false)" @mouseleave="handleCardLeave">
        <h4>{{ $t('ov_title_settings') }}</h4>

        <div class="setting-row">
          <label>{{ $t('ov_lbl_mode') }}</label>
          <select v-model="config.displayMode">
            <option value="SPLIT">{{ $t('ov_opt_split') }}</option>
            <option value="TOTAL">{{ $t('ov_opt_total') }}</option>
            <option value="COMBINED">{{ $t('ov_opt_combined') }}</option>
            <option value="REALTIME">{{ $t('ov_opt_realtime') }}</option>
          </select>
        </div>

        <div class="setting-row">
          <label>{{ $t('ov_lbl_opacity') }}</label>
          <input type="range" v-model.number="config.opacity" min="0" max="1" step="0.05">
          <span>{{ Math.round(config.opacity * 100) }}%</span>
        </div>

        <div class="setting-row">
          <label>{{ $t('ov_lbl_color') }}</label>
          <input type="color" v-model="config.color">
        </div>

        <div class="setting-actions">
          <button class="btn-reset-style" @click="resetStyle">{{ $t('ov_btn_reset_def') }}</button>
          <button class="btn-close-settings" @click="showSettings = false">{{ $t('ov_btn_close_settings') }}</button>
        </div>
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
      :style="[getCardStyle(refKey), cardStyle, scoreScaleStyle]"
      @mousedown="startDrag($event, refKey)"
      @mouseenter="setIgnoreMouse(false)"
      @mouseleave="handleCardLeave"
    >
      <div class="overlay-header">
         <span class="ref-label">{{ ref.name }}</span>
      </div>

      <div class="score-body">

        <div
          v-if="config.displayMode === 'SPLIT'"
          class="score-grid-row font-scale-target"
          :class="{ active: fontScaleTargetKey === refKey }"
          @mousedown="handleFontTargetMouseDown($event, refKey)"
          @wheel="handleFontWheel($event, refKey)"
        >
          <div class="grid-cell right-align">
            <span class="score-val plus">+{{ ref.plus }}</span>
          </div>
          <div class="grid-cell center-align">
            <span class="score-divider">/</span>
          </div>
          <div class="grid-cell left-align">
            <span class="score-val minus">-{{ ref.minus }}</span>
            <template v-if="ref.mode === 'DUAL' && ref.penalty > 0">
              <span class="score-divider">/</span>
              <span class="score-val penalty-text">-{{ ref.penalty }}</span>
            </template>
          </div>
        </div>

        <div
          v-else-if="config.displayMode === 'TOTAL'"
          class="score-single-row font-scale-target"
          :class="{ active: fontScaleTargetKey === refKey }"
          @mousedown="handleFontTargetMouseDown($event, refKey)"
          @wheel="handleFontWheel($event, refKey)"
        >
          <span class="score-val total">{{ ref.total }}</span>
          <template v-if="ref.mode === 'DUAL' && ref.penalty > 0">
             <span class="score-divider total-divider">/</span>
             <span class="score-val penalty-text total-penalty">-{{ ref.penalty }}</span>
          </template>
        </div>

        <div
          v-else-if="config.displayMode === 'COMBINED'"
          class="score-combined-col font-scale-target"
          :class="{ active: fontScaleTargetKey === refKey }"
          @mousedown="handleFontTargetMouseDown($event, refKey)"
          @wheel="handleFontWheel($event, refKey)"
        >
          <div class="combined-total">{{ ref.total }}</div>
          <div class="combined-detail">
            <span class="mini-plus">+{{ ref.plus }}</span>
            <span class="score-divider-small">/</span>
            <span class="mini-minus">-{{ ref.minus }}</span>
            <template v-if="ref.mode === 'DUAL' && ref.penalty > 0">
               <span class="score-divider-small">/</span>
               <span class="penalty-text">-{{ ref.penalty }}</span>
            </template>
          </div>
        </div>

        <div
          v-else-if="config.displayMode === 'REALTIME'"
          class="score-grid-row realtime-layout font-scale-target"
          :class="{ active: fontScaleTargetKey === refKey }"
          @mousedown="handleFontTargetMouseDown($event, refKey)"
          @wheel="handleFontWheel($event, refKey)"
        >
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

            <transition name="pop">
              <span v-if="ref.mode === 'DUAL' && getRealTimeScore(refKey, 'penalty') > 0" class="rt-penalty-container">
                <span class="score-divider">/</span>
                <span class="score-val penalty-text">-{{ getRealTimeScore(refKey, 'penalty') }}</span>
              </span>
            </transition>
          </div>
        </div>
      </div>

      <div class="resize-handle" @mousedown.stop.prevent="startResize($event, refKey)"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { useCompetitionStore } from '../stores/competitionStore'
import { useMatchStore } from '../stores/matchStore'
import WaveformWidget from './WaveformWidget.vue'

const store = useMatchStore()
const competitionStore = useCompetitionStore()
const GRID_SIZE = 20
const MIN_REF_CARD_W = 100
const MIN_REF_CARD_H = 60
const MIN_FONT_SCALE = 0.6
const MAX_FONT_SCALE = 2.4
const FONT_SCALE_STEP = 0.05
const FONT_SCALE_SELECTOR = '.score-val, .score-divider, .combined-total, .combined-detail, .score-divider-small'
const cardPositions = reactive({})
const fontScaleTargetKey = ref(null)
let draggingRefKey = null
let dragOffset = { x: 0, y: 0 }
let isDragging = false

// 调整大小相关变量
let isResizing = false
const resizeState = { startX: 0, startY: 0, startW: 0, startH: 0 }

const showWaveform = ref(true)
const showSettings = ref(false)
const isDockVisible = ref(false)
const contextChangePending = ref(false)
const waveformCardRef = ref(null)
let resizeObserver = null

const previousScores = {}
const realTimeData = reactive({})
const BURST_THRESHOLD = 300
const DISPLAY_DURATION = 1000

const defaultConfig = {
  opacity: 0.85,
  color: '#141414',
  displayMode: 'SPLIT',
  fontScale: 1
}
const config = reactive({ ...defaultConfig })

const loadConfig = () => {
  const saved = localStorage.getItem('overlay_config_v2')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      Object.assign(config, parsed)
    } catch {
      // Ignore invalid persisted overlay config.
    }
  }
}
watch(config, (newVal) => {
  localStorage.setItem('overlay_config_v2', JSON.stringify(newVal))
})
const resetStyle = () => Object.assign(config, defaultConfig)
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

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
const scoreScaleStyle = computed(() => ({
  '--score-font-scale': `${config.fontScale || 1}`
}))

watch(() => store.referees, (newRefs) => {
  Object.keys(newRefs).forEach(key => {
    const ref = newRefs[key]

    // 初始化 previousScores
    if (!previousScores[key]) {
      previousScores[key] = { plus: ref.plus, minus: ref.minus, penalty: ref.penalty || 0 }
      return
    }

    const prev = previousScores[key]
    const deltaPlus = ref.plus - prev.plus
    const deltaMinus = ref.minus - prev.minus
    const deltaPenalty = (ref.penalty || 0) - (prev.penalty || 0)

    // 更新缓存
    previousScores[key] = { plus: ref.plus, minus: ref.minus, penalty: ref.penalty || 0 }

    // 触发连击逻辑
    if (deltaPlus > 0) processBurstScore(key, 'plus', deltaPlus)
    if (deltaMinus > 0) processBurstScore(key, 'minus', deltaMinus)
    if (deltaPenalty > 0) processBurstScore(key, 'penalty', deltaPenalty)

    // 重置逻辑
    if (ref.plus === 0 && ref.minus === 0) {
      clearRealTimeScore(key)
    }
  })
}, { deep: true })

const processBurstScore = (key, type, delta) => {
  if (!realTimeData[key]) {
    realTimeData[key] = {
      plus: { val: 0, lastTime: 0, timer: null },
      minus: { val: 0, lastTime: 0, timer: null },
      penalty: { val: 0, lastTime: 0, timer: null }
    }
  }
  // 补全可能缺失的 penalty 对象
  if (!realTimeData[key].penalty) {
    realTimeData[key].penalty = { val: 0, lastTime: 0, timer: null }
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
    if (realTimeData[key].penalty) {
       realTimeData[key].penalty.val = 0
    }
  }
}

const getRealTimeScore = (key, type) => {
  return (realTimeData[key] && realTimeData[key][type]) ? realTimeData[key][type].val : 0
}

const onDockEnter = () => { isDockVisible.value = true; setIgnoreMouse(false) }
const onDockLeave = () => {
  if (!showSettings.value) isDockVisible.value = false
  if (!isDragging && !isResizing && !showSettings.value) setIgnoreMouse(true)
}
const toggleSettings = () => { showSettings.value = !showSettings.value }

const handleBackgroundClick = () => {
  clearFontScaling()
  if (showSettings.value) {
    showSettings.value = false
    setIgnoreMouse(true)
    return
  }

  if (!isDragging && !isResizing) setIgnoreMouse(true)
}

let removeInitialDataListener = () => {}
let removeRefereeUpdateListener = () => {}
let removeContextUpdateListener = () => {}
let removeStatusUpdateListener = () => {}
if (window.ftOverlay) {
  removeInitialDataListener = window.ftOverlay.onInitialData((data) => {
    if (data.referees) {
      store.referees = data.referees
      initCardPositions()
      Object.keys(data.referees).forEach(k => {
        if (data.referees[k]) {
           previousScores[k] = {
             plus: data.referees[k].plus,
             minus: data.referees[k].minus,
             penalty: data.referees[k].penalty || 0
           }
        }
      })
    }
    if (data.context) {
      store.currentContext = data.context
    }
    if (data.projectConfig) {
      competitionStore.projectConfig = data.projectConfig
    }
    if (data.stages) competitionStore.stages = data.stages
    if (data.activeStageId) competitionStore.activeStageId = data.activeStageId
    if (data.activeAttemptNumber) competitionStore.activeAttemptNumber = data.activeAttemptNumber
  })
  removeRefereeUpdateListener = window.ftOverlay.onRefereeUpdated((update) => {
    store.updateScore(update)
  })
  removeContextUpdateListener = window.ftOverlay.onContextUpdated((context) => {
    store.currentContext = context
  })
  removeStatusUpdateListener = window.ftOverlay.onStatusUpdated((status) => {
    store.matchStatus = status
    store.matchActive = status.state === 'starting' || status.state === 'active'
  })
}

watch(() => store.referees, () => { initCardPositions() }, { deep: true })
watch(showWaveform, (val) => {
  if (val) nextTick(() => setupResizeObserver())
  else if (resizeObserver) resizeObserver.disconnect()
})

const getRefereeKeys = () => Object.keys(store.referees)

const getSharedRefCardSize = () => {
  for (const refKey of getRefereeKeys()) {
    const pos = cardPositions[refKey]
    if (pos?.w && pos?.h) {
      return { w: pos.w, h: pos.h }
    }
  }
  return null
}

const syncRefCardSize = (width, height) => {
  const syncedWidth = Math.max(MIN_REF_CARD_W, width)
  const syncedHeight = Math.max(MIN_REF_CARD_H, height)

  getRefereeKeys().forEach((refKey, idx) => {
    if (!cardPositions[refKey]) {
      cardPositions[refKey] = { x: 20, y: 80 + (idx * 120) }
    }

    cardPositions[refKey].w = syncedWidth
    cardPositions[refKey].h = syncedHeight
  })
}

const clearFontScaling = () => {
  fontScaleTargetKey.value = null
}

const activateFontScaling = (key) => {
  if (isDragging || isResizing) return
  fontScaleTargetKey.value = key
  setIgnoreMouse(false)
}

const isFontScaleHit = (target) => {
  return target instanceof Element && Boolean(target.closest(FONT_SCALE_SELECTOR))
}

const handleFontTargetMouseDown = (e, key) => {
  if (!isFontScaleHit(e.target)) return
  e.stopPropagation()
  e.preventDefault()
  activateFontScaling(key)
}

const handleFontWheel = (e, key) => {
  if (isDragging || isResizing) return
  if (fontScaleTargetKey.value !== key || !isFontScaleHit(e.target)) return

  e.stopPropagation()
  e.preventDefault()

  const delta = e.deltaY < 0 ? FONT_SCALE_STEP : -FONT_SCALE_STEP
  const nextScale = clamp(
    Number(((config.fontScale || 1) + delta).toFixed(2)),
    MIN_FONT_SCALE,
    MAX_FONT_SCALE
  )

  config.fontScale = nextScale
}

const initCardPositions = () => {
  const sharedSize = getSharedRefCardSize()
  Object.keys(store.referees).forEach((refKey, idx) => {
    if (!cardPositions[refKey]) {
      cardPositions[refKey] = {
        x: 20,
        y: 80 + (idx * 120),
        ...(sharedSize || {})
      }
      return
    }

    if (sharedSize) {
      if (!cardPositions[refKey].w) cardPositions[refKey].w = sharedSize.w
      if (!cardPositions[refKey].h) cardPositions[refKey].h = sharedSize.h
    }
  })
  if (!cardPositions['waveform']) {
    const initW = 600
    const initH = 220
    const screenW = window.innerWidth
    const screenH = window.innerHeight
    cardPositions['waveform'] = { x: (screenW - initW) / 2, y: screenH - initH - 50, w: initW, h: initH }
  }
  if (!cardPositions['dock']) {
    const dockW = 380
    cardPositions['dock'] = { x: (window.innerWidth - dockW) / 2, y: 0 }
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
  initCardPositions()
  setupResizeObserver()
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)

  window.ftOverlay?.ready()
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
  if (resizeObserver) resizeObserver.disconnect()
  removeInitialDataListener()
  removeRefereeUpdateListener()
  removeContextUpdateListener()
  removeStatusUpdateListener()
})

const closeOverlay = () => window.ftOverlay?.close()
const setIgnoreMouse = (ignore) => window.ftOverlay?.setClickThrough(ignore)
const handleCardLeave = () => {
  clearFontScaling()
  if (!isDragging && !isResizing && !showSettings.value) setIgnoreMouse(true)
}
const toggleWaveform = () => { showWaveform.value = !showWaveform.value }

const getWaveformStyle = () => {
  const pos = cardPositions['waveform'] || { x: 0, y: 0 }
  return { left: `${pos.x}px`, top: `${pos.y}px`, zIndex: draggingRefKey === 'waveform' ? 9999 : 1000, position: 'absolute' }
}

const getCardStyle = (key) => {
  const pos = cardPositions[key] || { x: 0, y: 0 }
  return {
    left: `${pos.x}px`,
    top: `${pos.y}px`,
    width: pos.w ? `${pos.w}px` : '180px',
    height: pos.h ? `${pos.h}px` : 'auto',
    zIndex: draggingRefKey === key ? 9999 : 1000,
    position: 'absolute'
  }
}

const getDockZoneStyle = () => {
  const pos = cardPositions['dock'] || { x: 0, y: 0 }
  return { left: `${pos.x}px`, top: `${pos.y}px`, transform: 'none' }
}

const startResize = (e, key) => {
  if (e.button !== 0) return
  isResizing = true
  draggingRefKey = key
  clearFontScaling()
  setIgnoreMouse(false)

  const pos = cardPositions[key]
  if (!pos.w || !pos.h) {
    const el = e.target.closest('.score-card')
    const rect = el.getBoundingClientRect()
    pos.w = Math.round(rect.width / GRID_SIZE) * GRID_SIZE
    pos.h = Math.round(rect.height / GRID_SIZE) * GRID_SIZE
  }

  syncRefCardSize(pos.w, pos.h)

  resizeState.startX = e.clientX
  resizeState.startY = e.clientY
  resizeState.startW = pos.w
  resizeState.startH = pos.h
}

const startDrag = (e, key) => {
  if (e.button !== 0) return
  if (key === 'dock' && (e.target.closest('button') || e.target.closest('input'))) return

  const target = e.currentTarget.getBoundingClientRect()
  if (key !== 'dock') {
    const isRightEdge = e.clientX - target.left > target.width - 25
    const isBottomEdge = e.clientY - target.top > target.height - 25
    if (key === 'waveform' && isRightEdge && isBottomEdge) return
  }

  clearFontScaling()
  isDragging = true
  draggingRefKey = key
  setIgnoreMouse(false)
  const pos = cardPositions[key] || { x: 0, y: 0 }
  dragOffset = { x: e.clientX - pos.x, y: e.clientY - pos.y }
}

const onDrag = (e) => {
  if (!draggingRefKey) return

  if (isResizing) {
    const dx = e.clientX - resizeState.startX
    const dy = e.clientY - resizeState.startY

    const newW = Math.max(MIN_REF_CARD_W, Math.round((resizeState.startW + dx) / GRID_SIZE) * GRID_SIZE)
    const newH = Math.max(MIN_REF_CARD_H, Math.round((resizeState.startH + dy) / GRID_SIZE) * GRID_SIZE)

    if (store.referees[draggingRefKey]) {
      syncRefCardSize(newW, newH)
    } else {
      const pos = cardPositions[draggingRefKey]
      if (pos) {
        pos.w = newW
        pos.h = newH
      }
    }
    return
  }

  let rawX = e.clientX - dragOffset.x
  let rawY = e.clientY - dragOffset.y

  let finalX = Math.round(rawX / GRID_SIZE) * GRID_SIZE
  let finalY = Math.round(rawY / GRID_SIZE) * GRID_SIZE

  // 强制 Dock 只能左右移动 (Y=0)
  if (draggingRefKey === 'dock') {
    finalY = 0
  }

  const newPos = { x: finalX, y: finalY }
  const oldPos = cardPositions[draggingRefKey]
  if (oldPos && oldPos.w) { newPos.w = oldPos.w; newPos.h = oldPos.h }

  cardPositions[draggingRefKey] = newPos
}

const stopDrag = () => {
  isDragging = false
  isResizing = false
  draggingRefKey = null
}

const changePlayer = async (delta) => {
  if (contextChangePending.value) return
  const groupName = store.currentContext.groupName
  const group = competitionStore.projectConfig.groups.find(g => g.name === groupName)
  if (!group) return
  const currentIdx = group.players.indexOf(store.currentContext.contestantName)

  contextChangePending.value = true
  try {
    if (delta > 0 && store.currentContext.contestantName) {
      store.broadcastPlayerScored(store.currentContext.contestantName)
    }

    const nextIdx = currentIdx + delta

    if (nextIdx >= group.players.length && competitionStore.projectConfig.mode === 'FREE') {
      const newPlayerName = `Player ${group.players.length + 1}`
      group.players.push(newPlayerName)
      await competitionStore.updateGroups(competitionStore.projectConfig.groups)
      await store.setMatchContext(groupName, newPlayerName)
    } else if (group.players[nextIdx]) {
      await store.setMatchContext(groupName, group.players[nextIdx])
    }
  } finally {
    contextChangePending.value = false
  }
}
</script>

<style scoped lang="scss">
.overlay-container { width: 100vw; height: 100vh; overflow: hidden; background: transparent; }
.dock-trigger-zone {
  position: absolute;
  top: 0;
  width: 380px;
  height: 40px;
  z-index: 10000;
  display: flex;
  justify-content: center;
}
.overlay-dock { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); transform: translateY(-100%); padding-top: 5px; &.visible { transform: translateY(0); } }

.dock-content {
  background: rgba(0, 0, 0, 0.85);
  padding: 6px 15px;
  border-radius: 0 0 10px 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: white;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  cursor: grab;
}
.dock-content:active {
  cursor: grabbing;
}

.dock-info {
  font-weight: bold;
  font-size: 0.9rem;
  margin-right: 5px;
  color: #ddd;

  /* 【修改点2】宽度改为 95px */
  max-width: 95px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-dock { background: #444; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.9rem; transition: 0.2s; &.active { background: #3498db; } &:hover { filter: brightness(1.2); } }
.btn-dock-reset { background: #f39c12; }
.btn-dock-exit { background: #e74c3c; }

.settings-panel { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); background: #252526; border: 1px solid #444; padding: 15px; border-radius: 8px; z-index: 10001; color: white; width: 280px; box-shadow: 0 5px 20px rgba(0,0,0,0.5); h4 { margin: 0 0 15px 0; text-align: center; color: #ccc; } .setting-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; label { font-size: 0.9rem; color: #aaa; } input[type=range] { width: 100px; } input[type=color] { border: none; width: 40px; height: 25px; padding: 0; background: none; } select { background: #333; color: white; border: 1px solid #555; padding: 2px 5px; border-radius: 4px; width: 140px; } span { width: 40px; text-align: right; font-size: 0.85rem; } } .setting-actions { display: flex; justify-content: space-between; margin-top: 15px; button { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; } .btn-reset-style { background: #555; color: white; } .btn-close-settings { background: #3498db; color: white; } } }

.score-card { --score-font-scale: 1; color: white; border-left: 4px solid #3498db; padding: 10px; cursor: grab; user-select: none; display: flex; flex-direction: column; transition: background-color 0.2s, box-shadow 0.2s; position: relative; &:active { cursor: grabbing; border-color: #2ecc71; } }
.score-card:not(.waveform-card) { }
.waveform-card { resize: both; overflow: hidden; min-width: 200px; min-height: 100px; padding: 0; padding-left: 5px; transform: translateZ(0); backface-visibility: hidden; }
.resize-handle-visual { position: absolute; bottom: 2px; right: 2px; width: 12px; height: 12px; border-right: 3px solid #666; border-bottom: 3px solid #666; pointer-events: none; opacity: 0.6; }

.overlay-header { font-size: 0.85rem; color: #aaa; border-bottom: 1px solid #444; margin-bottom: 5px; padding-bottom: 2px; }
.score-body { display: flex; align-items: center; justify-content: center; min-height: calc(40px * var(--score-font-scale)); width: 100%; flex: 1; overflow: hidden; }

.score-grid-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; width: 100%; }
.score-single-row,
.score-combined-col,
.font-scale-target { width: 100%; }
.font-scale-target { cursor: zoom-in; }
.font-scale-target.active { cursor: ns-resize; }
.grid-cell { white-space: nowrap; }
.left-align { text-align: left; }
.center-align { text-align: center; }
.right-align { text-align: right; }
.fixed-slot { min-height: calc(32px * var(--score-font-scale)); display: flex; align-items: center; }
.fixed-slot.right-align { justify-content: flex-end; }
.fixed-slot.left-align { justify-content: flex-start; }

.score-val { font-size: calc(2rem * var(--score-font-scale)); font-weight: bold; line-height: 1; &.plus { color: #fff; } &.minus { color: #ff6b6b; } &.total { font-size: calc(2.5rem * var(--score-font-scale)); color: #2ecc71; } }
.score-divider { font-size: calc(1.5rem * var(--score-font-scale)); color: #666; margin: 0 5px; font-weight: lighter; }
.score-combined-col { display: flex; flex-direction: column; align-items: center; }
.combined-total { font-size: calc(2rem * var(--score-font-scale)); font-weight: bold; color: #2ecc71; line-height: 1; margin-bottom: 2px; }
.combined-detail { font-size: calc(0.9rem * var(--score-font-scale)); color: #bbb; .mini-plus { color: #ddd; } .mini-minus { color: #ff6b6b; } }
.pop-enter-active, .pop-leave-active { transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(0.5); }

.resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
  z-index: 20;
}

.resize-handle::after {
  content: '';
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  border-right: 3px solid #666;
  border-bottom: 3px solid #666;
  opacity: 0.5;
  pointer-events: none;
}

.resize-handle:hover::after {
  opacity: 1;
  border-color: #999;
}

/* 【修改】重点扣分通用样式 */
.penalty-text {
  color: #ff6b6b; /* 醒目红 */
  font-weight: 800;
  font-size: inherit; /* 默认继承，便于在 Combined 模式下自动变小 */
}

/* 实时模式下需要包含 divider 的容器 */
.rt-penalty-container {
  display: inline-block;
  margin-left: calc(5px * var(--score-font-scale));
}

/* Total 模式下的 Divider */
.total-divider {
  vertical-align: middle;
}

/* Combined 模式下的 Divider */
.score-divider-small {
  margin: 0 4px;
  color: #666;
  font-size: calc(0.9rem * var(--score-font-scale));
  font-weight: lighter;
}
</style>
