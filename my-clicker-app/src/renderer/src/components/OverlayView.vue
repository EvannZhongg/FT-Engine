<template>
  <div class="overlay-container">
    <div class="overlay-dock" @mouseenter="setIgnoreMouse(false)" @mouseleave="handleDockLeave">
      <div class="dock-content">
        <span class="dock-info">{{ store.currentContext.contestantName || 'Waiting...' }}</span>
        <button class="btn-dock" @click="changePlayer(1)">Next ▶</button>
        <button class="btn-dock btn-dock-reset" @click="store.resetAll()">R</button>
        <button class="btn-dock btn-dock-exit" @click="closeOverlay">Exit ✖</button>
      </div>
    </div>

    <div
      v-for="(ref, refKey) in store.referees"
      :key="refKey"
      class="score-card draggable-card"
      :style="getCardStyle(refKey)"
      @mousedown="startDrag($event, refKey)"
      @mouseenter="setIgnoreMouse(false)"
      @mouseleave="handleCardLeave"
    >
      <div class="overlay-header">
         <span class="ref-label">{{ ref.name }}</span>
      </div>

      <div class="score-split-row">
        <span class="score-val plus">+{{ ref.plus }}</span>
        <span class="score-divider">/</span>
        <span class="score-val minus">-{{ ref.minus }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import {ref, reactive, onMounted, onUnmounted, watch} from 'vue'
import {useRefereeStore} from '../stores/refereeStore'

const store = useRefereeStore()
const GRID_SIZE = 20
const cardPositions = reactive({})
let draggingRefKey = null
let dragOffset = {x: 0, y: 0}
let isDragging = false

// --- 初始化与同步 ---

// 1. 监听 IPC 传来的初始数据 (解决首次显示延迟问题)
if (window.electron) {
  window.electron.ipcRenderer.on('init-overlay-data', (event, data) => {
    console.log("Overlay received initial state:", data)
    if (data.referees) {
      store.referees = data.referees
      initCardPositions() // 收到数据立即初始化位置
    }
    if (data.context) {
      store.currentContext = data.context
    }
  })
}

// 2. 监听 Store 变化 (解决后续新增裁判或 WS 更新带来的变化)
watch(() => store.referees, () => {
  initCardPositions()
}, {deep: true})

const initCardPositions = () => {
  Object.keys(store.referees).forEach((refKey, idx) => {
    if (!cardPositions[refKey]) {
      // 默认位置：垂直排列
      cardPositions[refKey] = {x: 20, y: 80 + (idx * 120)}
    }
  })
}

onMounted(() => {
  store.connectWebSocket()
  initCardPositions() // 尝试初始化 (万一 Store 已经有默认值)
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
  if (window.electron) window.electron.ipcRenderer.removeAllListeners('init-overlay-data')
})

// --- 窗口交互 ---
const closeOverlay = () => {
  if (window.electron) window.electron.ipcRenderer.send('close-overlay')
}
const setIgnoreMouse = (ignore) => {
  if (window.electron) window.electron.ipcRenderer.send('set-ignore-mouse', ignore)
}
const handleDockLeave = () => {
  setIgnoreMouse(true)
}
const handleCardLeave = () => {
  if (!isDragging) setIgnoreMouse(true)
}

// --- 拖拽逻辑 ---
const getCardStyle = (refKey) => {
  const pos = cardPositions[refKey] || {x: 0, y: 0}
  return {left: `${pos.x}px`, top: `${pos.y}px`, zIndex: draggingRefKey === refKey ? 9999 : 1000, position: 'absolute'}
}

const startDrag = (e, refKey) => {
  if (e.button !== 0) return
  isDragging = true
  draggingRefKey = refKey
  setIgnoreMouse(false)
  const pos = cardPositions[refKey] || {x: 0, y: 0}
  dragOffset = {x: e.clientX - pos.x, y: e.clientY - pos.y}
}

const onDrag = (e) => {
  if (!draggingRefKey) return
  let rawX = e.clientX - dragOffset.x
  let rawY = e.clientY - dragOffset.y
  cardPositions[draggingRefKey] = {
    x: Math.round(rawX / GRID_SIZE) * GRID_SIZE,
    y: Math.round(rawY / GRID_SIZE) * GRID_SIZE
  }
}

const stopDrag = () => {
  isDragging = false;
  draggingRefKey = null
}

const changePlayer = async (delta) => {
  // 简易切人逻辑，依赖 WS 同步回传 context_update
  const groupName = store.currentContext.groupName
  const group = store.projectConfig.groups.find(g => g.name === groupName)
  if (!group) return
  const currentIdx = group.players.indexOf(store.currentContext.contestantName)
  const nextIdx = currentIdx + delta
  if (group.players[nextIdx]) {
    await store.setMatchContext(groupName, group.players[nextIdx])
  }
}
</script>

<style scoped lang="scss">
.overlay-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: transparent;
}

.overlay-dock {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  padding-top: 5px;
}

.dock-content {
  background: rgba(0, 0, 0, 0.7);
  padding: 4px 10px;
  border-radius: 0 0 8px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: white;
}

.dock-info {
  font-weight: bold;
  font-size: 0.9rem;
  margin-right: 5px;
}

.btn-dock {
  background: #555;
  color: white;
  border: none;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

.btn-dock:hover {
  filter: brightness(1.2);
}

.btn-dock-reset {
  background: #f39c12;
}

.btn-dock-exit {
  background: #e74c3c;
}

/* 裁判卡片样式优化 */
.score-card {
  background: rgba(20, 20, 20, 0.85);
  color: white;
  border-left: 4px solid #3498db;
  padding: 10px;
  width: 160px; /*稍微加宽以容纳两个数字*/
  box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.5);
  cursor: grab;
  user-select: none;
  display: flex;
  flex-direction: column;
}

.score-card:active {
  cursor: grabbing;
  border-color: #2ecc71;
}

.overlay-header {
  font-size: 0.85rem;
  color: #aaa;
  border-bottom: 1px solid #444;
  margin-bottom: 5px;
  padding-bottom: 2px;
}

/* 新的分数布局样式 */
.score-split-row {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: monospace; /* 等宽字体对齐更好看 */
}

.score-val {
  font-size: 2rem;
  font-weight: bold;
  line-height: 1;
}

.score-val.plus {
  color: #fff;
}

.score-val.minus {
  color: #ff6b6b;
}

/* 负分标红 */

.score-divider {
  font-size: 1.5rem;
  color: #666;
  margin: 0 8px;
  font-weight: lighter;
}
</style>
