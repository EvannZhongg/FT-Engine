<template>
  <div class="score-board">
    <div class="header">
      <div class="header-section left">
        <button class="btn-stop" @click="$emit('stop')">
          <span class="icon">←</span> Stop
        </button>
      </div>

      <div class="header-section center">
        <div class="group-label">{{ store.currentContext.groupName || 'Free Mode' }}</div>

        <div class="player-navigator">
          <button class="nav-btn" @click="manualChange(-1)">◀</button>

          <select class="player-select" :value="store.currentContext.contestantName" @change="onSelectPlayer">
            <option
              v-for="p in currentGroupPlayers"
              :key="p"
              :value="p"
              :class="{ 'option-scored': store.scoredPlayers.has(p) }"
            >
              {{ p }} {{ store.scoredPlayers.has(p) ? '✔' : '' }}
            </option>
          </select>

          <button class="nav-btn" @click="manualChange(1)">▶</button>
        </div>
      </div>

      <div class="header-section right">
        <div class="toggle-switch" title="Auto Next">
          <input type="checkbox" id="autoSwitch" v-model="isAutoNext">
          <label for="autoSwitch" class="toggle-label">
            <span class="toggle-switch-handle"></span>
          </label>
          <span class="toggle-text">Auto</span>
        </div>

        <button class="btn-tool btn-overlay" @click="openWindowSelector">🔳 Overlay</button>

        <button class="btn-tool btn-reset" @click="handleNextClick">
            {{ isAllDone ? '🏁 Finish' : '⏭ Next' }}
        </button>

        <button class="btn-tool btn-reset-only" @click="handleResetOnly" title="Reset current only">⚠ Zero</button>
      </div>
    </div>

    <div class="panels-container">
      <div v-for="(ref, refKey) in store.referees" :key="refKey" class="score-card">
        <div class="card-top">
          <div class="ref-name">{{ ref.name }}</div>
          <div class="status-indicators">
            <div class="status-dot" :class="ref.status?.pri || 'disconnected'"></div>
            <div v-if="ref.status?.sec !== 'n/a'" class="status-dot" :class="ref.status?.sec || 'disconnected'"></div>
          </div>
        </div>
        <div class="score-main">{{ ref.total }}</div>
        <div class="score-detail">
          <span class="plus">+{{ ref.plus }}</span> / <span class="minus">-{{ ref.minus }}</span>
        </div>
      </div>
    </div>

    <div v-if="showWindowSelector" class="modal-overlay">
       <div class="modal-content">
        <h3>Select Game Window</h3>
        <select v-model="selectedTargetWindow" class="win-select">
          <option value="" disabled>-- Select Application --</option>
          <option value="FULL_SCREEN">[ Full Screen Mode ]</option>
          <option v-for="w in windowList" :key="w" :value="w">{{ w }}</option>
        </select>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showWindowSelector = false">Cancel</button>
          <button class="btn-confirm" @click="confirmOverlay">Start Overlay</button>
        </div>
      </div>
    </div>

    <div v-if="showResetDialog" class="modal-overlay">
      <div class="modal-content">
        <h3>Confirm Next</h3>
        <p>Save score and move to next?</p>
        <label class="dont-ask-label"><input type="checkbox" v-model="dontAskAgainTemp"> Don't ask again</label>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showResetDialog = false">Cancel</button>
          <button class="btn-confirm" @click="confirmSmartNext">Confirm</button>
        </div>
      </div>
    </div>

    <div v-if="showAllDoneDialog" class="modal-overlay">
      <div class="modal-content">
        <h3>🎉 All Scored!</h3>
        <p>All contestants in this group have been scored.</p>
        <div class="modal-actions vertical-actions">
          <button class="btn-confirm large" @click="finishMatch">Save & Exit Match</button>
          <button class="btn-cancel large" @click="overwriteNext">Overwrite Next (Re-judge)</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'

const emit = defineEmits(['stop'])
const store = useRefereeStore()

// 状态
const isAutoNext = ref(false)
const showResetDialog = ref(false)
const showAllDoneDialog = ref(false)
const dontAskAgainTemp = ref(false)
const showWindowSelector = ref(false)
const windowList = ref([])
const selectedTargetWindow = ref("")

// 计算属性
const currentGroupPlayers = computed(() => {
  const gName = store.currentContext.groupName
  const group = store.projectConfig.groups.find(g => g.name === gName)
  return group ? group.players : []
})

const currentIdx = computed(() => {
  return currentGroupPlayers.value.indexOf(store.currentContext.contestantName)
})

const isAllDone = computed(() => {
  const players = currentGroupPlayers.value
  if (players.length === 0) return false
  return players.every(p => store.scoredPlayers.has(p))
})

onMounted(() => {
  store.connectWebSocket()
  store.fetchSettings()
  if (store.currentContext.groupName) {
    store.fetchScoredPlayers(store.currentContext.groupName)
  }
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => { window.removeEventListener('keydown', handleKeydown) })

// --- 核心修复区域 ---

// 1. 点击 Next 或 自动跳转
const handleNextClick = () => {
  if (store.appSettings.suppress_reset_confirm || isAutoNext.value) {
    confirmSmartNext()
  } else {
    dontAskAgainTemp.value = false
    showResetDialog.value = true
  }
}

// 2. 执行跳转逻辑 (关键修复：先切换，再归零)
const confirmSmartNext = async () => {
  if (dontAskAgainTemp.value) store.updateSetting('suppress_reset_confirm', true)
  showResetDialog.value = false

  // 标记当前选手已完成
  const currentName = store.currentContext.contestantName
  store.markAsScored(currentName)

  // 查找下一位
  const nextPlayer = findNextUnscoredPlayer()

  if (nextPlayer) {
    // 【关键修改点】
    // 1. 先切换上下文到下一位选手 (Backend 会将日志目标指向新选手)
    await switchContext(nextPlayer)

    // 2. 然后再归零设备 (产生的 0 分日志会记录在新选手名下，作为初始状态)
    // 这样上一位选手的最后一条日志就是他的最终得分
    await store.resetAll()
  } else {
    // 如果没有下一位了 (全部完成)，千万不要 resetAll，否则最后一位选手成绩会变 0
    showAllDoneDialog.value = true
  }
}

// 算法：寻找下一个未打分的
const findNextUnscoredPlayer = () => {
  const players = currentGroupPlayers.value
  const len = players.length
  if (len === 0) return null
  for (let i = 1; i < len; i++) {
    const idx = (currentIdx.value + i) % len
    const pName = players[idx]
    if (!store.scoredPlayers.has(pName)) return pName
  }
  return null
}

// --- 其他操作 ---

const finishMatch = () => {
  showAllDoneDialog.value = false
  emit('stop') // 正常退出，不归零，保留最后一位选手的成绩
}

const overwriteNext = async () => {
  showAllDoneDialog.value = false
  // 逻辑：覆盖下一位 (循环回到第一个或下一个)
  const players = currentGroupPlayers.value
  const nextIdx = (currentIdx.value + 1) % players.length
  const nextPlayer = players[nextIdx]

  // 即使已完成，也强制切过去，并且归零准备重打
  await switchContext(nextPlayer)
  await store.resetAll()
}

const switchContext = async (contestantName) => {
  await store.setMatchContext(store.currentContext.groupName, contestantName)
}

// 仅归零当前设备 (不切人，用于误操作重打)
const handleResetOnly = async () => {
  if (confirm("Reset current scores to ZERO?")) {
    await store.resetAll() // 这里确实需要归零当前选手，因为是用户明确要求的
  }
}

// 手动切换 (左右箭头)
const manualChange = async (delta) => {
  const players = currentGroupPlayers.value
  const len = players.length
  if (len === 0) return

  const nextIdx = (currentIdx.value + delta + len) % len
  const nextPlayer = players[nextIdx]

  // 【关键修改】手动切换时，也遵循 "先切人，后归零" 的原则
  // 假设用户想保留当前选手的成绩，切换去给下一个人打分
  await switchContext(nextPlayer)
  await store.resetAll()
}

// 下拉直接选择
const onSelectPlayer = async (e) => {
  const name = e.target.value
  // 【关键修改】同上
  await switchContext(name)
  await store.resetAll()
}

const handleKeydown = (e) => {
  if (e.ctrlKey && e.code === 'KeyG') { e.preventDefault(); handleNextClick() }
}

// --- Overlay 相关 (保持不变) ---
const openWindowSelector = async () => {
  windowList.value = await store.fetchWindows()
  showWindowSelector.value = true
}
const confirmOverlay = async () => {
  if (!selectedTargetWindow.value) return
  let targetBounds = null
  if (selectedTargetWindow.value !== "FULL_SCREEN") {
    const res = await store.getWindowBounds(selectedTargetWindow.value)
    if (res.found) targetBounds = res.bounds
  }
  showWindowSelector.value = false
  if (window.electron && window.electron.ipcRenderer) {
    const initialState = {
      referees: JSON.parse(JSON.stringify(store.referees)),
      context: JSON.parse(JSON.stringify(store.currentContext))
    }
    window.electron.ipcRenderer.send('open-overlay', { bounds: targetBounds, initialState: initialState })
  }
}
</script>

<style scoped lang="scss">
/* 保持原有样式，此处省略以节省篇幅，请直接复用上一次提供的 CSS */
.score-board { height: 100%; display: flex; flex-direction: column; background: transparent; }
.header { height: 70px; background: #252526; border-bottom: 1px solid #333; display: flex; align-items: center; justify-content: space-between; padding: 0 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); flex-shrink: 0; }
.header-section { display: flex; align-items: center; gap: 10px; }
.header-section.left { flex: 1; }
.header-section.center { flex: 2; justify-content: center; gap: 10px; }
.header-section.right { flex: 1; justify-content: flex-end; }
.player-navigator { display: flex; align-items: center; gap: 5px; background: #1a1a1a; padding: 4px 10px; border-radius: 6px; border: 1px solid #333; }
.player-select { background: transparent; color: white; border: none; font-size: 1.1rem; font-weight: bold; width: 140px; text-align: center; outline: none; appearance: none; cursor: pointer; option { background: #333; color: white; } option.option-scored { color: #2ecc71; } }
.nav-btn { background: none; color: #888; font-size: 1rem; padding: 0 5px; &:hover { color: #3498db; } }
.toggle-switch { display: flex; align-items: center; gap: 5px; margin-right: 10px; input { display: none; } .toggle-label { width: 36px; height: 18px; background: #444; border-radius: 18px; position: relative; cursor: pointer; transition: 0.3s; .toggle-switch-handle { width: 14px; height: 14px; background: white; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: 0.3s; } } input:checked + .toggle-label { background: #2ecc71; } input:checked + .toggle-label .toggle-switch-handle { left: 20px; } .toggle-text { font-size: 0.8rem; color: #aaa; } }
button { border: none; cursor: pointer; border-radius: 4px; transition: 0.2s; font-weight: bold; }
.btn-stop { background: #444; color: #ccc; padding: 6px 12px; display: flex; align-items: center; gap: 5px; }
.btn-tool { padding: 6px 12px; font-size: 0.9rem; color: white; margin-left: 5px; }
.btn-overlay { background: #3498db; }
.btn-reset { background: #27ae60; min-width: 80px; }
.btn-reset-only { background: #c0392b; font-size: 0.8rem; padding: 6px 8px; }
.panels-container { flex: 1; padding: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); grid-auto-rows: max-content; gap: 15px; overflow-y: auto; align-content: start; }
.score-card { background: #ecf0f1; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 8px rgba(0,0,0,0.2); color: #2c3e50; .card-top { width: 100%; display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 0.9rem; font-weight: bold; } .status-indicators { display: flex; gap: 4px; } .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #bdc3c7; &.connected { background: #2ecc71; } } .score-main { font-size: 4rem; font-weight: 800; line-height: 1; margin: 10px 0; } .score-detail { font-size: 1rem; color: #666; background: #ddd; padding: 2px 10px; border-radius: 10px; } }
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 2000; }
.modal-content { background: #2b2b2b; padding: 25px; border-radius: 8px; width: 380px; text-align: center; color: white; h3 { margin-top: 0; } }
.modal-actions { display: flex; justify-content: center; gap: 10px; margin-top: 20px; }
.vertical-actions { flex-direction: column; }
.btn-confirm { background: #3498db; color: white; padding: 8px 20px; }
.btn-cancel { background: #555; color: white; padding: 8px 20px; }
.large { width: 100%; margin-bottom: 10px; padding: 12px; font-size: 1rem; }
.win-select { width: 100%; padding: 8px; margin: 15px 0; background: #111; color: white; border: 1px solid #444; }
.dont-ask-label { display: block; margin-top: 15px; color: #aaa; cursor: pointer; input { margin-right: 5px; } }
</style>
