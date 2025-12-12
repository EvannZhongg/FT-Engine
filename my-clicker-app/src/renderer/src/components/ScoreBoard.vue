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
          <label for="autoSwitch" class="toggle-label"><span class="toggle-switch-handle"></span></label>
          <span class="toggle-text">Auto</span>
        </div>
        <button class="btn-tool btn-overlay" @click="openWindowSelector">🔳 Overlay</button>
        <button class="btn-tool btn-reset" @click="handleNextClick">
            {{ isAllDone ? '🏁 Finish' : '⏭ Next' }}
            <span class="shortcut-hint" v-if="store.appSettings.reset_shortcut">[{{ store.appSettings.reset_shortcut }}]</span>
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
        <div class="score-detail"><span class="plus">+{{ ref.plus }}</span> / <span class="minus">-{{ ref.minus }}</span></div>
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
        <p>All contestants have been scored.</p>
        <p v-if="store.projectConfig.mode==='TOURNAMENT'" style="font-size:0.9rem;color:#aaa">Do you want to re-judge from the first player?</p>
        <div class="modal-actions vertical-actions">
          <button class="btn-confirm large" @click="finishMatch">Save & Exit Match</button>
          <button class="btn-cancel large" @click="continueLoopMatch">
             {{ store.projectConfig.mode==='FREE' ? 'Continue (Add Player)' : 'Continue (Start Over)' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'

const emit = defineEmits(['stop'])
const store = useRefereeStore()

const isAutoNext = ref(false)
const showResetDialog = ref(false)
const showAllDoneDialog = ref(false)
const dontAskAgainTemp = ref(false)
const showWindowSelector = ref(false)
const windowList = ref([])
const selectedTargetWindow = ref("")

const currentGroupPlayers = computed(() => {
  const gName = store.currentContext.groupName
  const group = store.projectConfig.groups.find(g => g.name === gName)
  return group ? group.players : []
})

const currentIdx = computed(() => currentGroupPlayers.value.indexOf(store.currentContext.contestantName))
const isAllDone = computed(() => currentGroupPlayers.value.length > 0 && currentGroupPlayers.value.every(p => store.scoredPlayers.has(p)))

onMounted(async () => {
  store.connectWebSocket()
  store.fetchSettings()

  if (store.currentContext.groupName) {
    if (!store.currentContext.contestantName && currentGroupPlayers.value.length > 0) {
      await switchContext(currentGroupPlayers.value[0])
    }
    await store.fetchScoredPlayers(store.currentContext.groupName)
    initResumeState()
  }
  window.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.send('close-overlay')
  }
})

const initResumeState = async () => {
  if (isAllDone.value) {
    if (store.projectConfig.mode === 'FREE') {
      if (currentIdx.value === -1 && currentGroupPlayers.value.length > 0) {
        store.currentContext.contestantName = currentGroupPlayers.value[currentGroupPlayers.value.length - 1]
      }
      await changePlayer(1)
    } else {
      showAllDoneDialog.value = true
    }
  } else {
    const unscored = findNextUnscoredPlayer()
    if (unscored && unscored !== store.currentContext.contestantName) {
       await switchContext(unscored)
    }
  }
}

const handleNextClick = () => {
  if (store.appSettings.suppress_reset_confirm || isAutoNext.value) confirmSmartNext()
  else { dontAskAgainTemp.value = false; showResetDialog.value = true }
}

const confirmSmartNext = async () => {
  if (dontAskAgainTemp.value) store.updateSetting('suppress_reset_confirm', true)
  showResetDialog.value = false

  const currentName = store.currentContext.contestantName
  store.markAsScored(currentName)

  const nextPlayer = findNextUnscoredPlayer()

  if (nextPlayer) {
    await switchContext(nextPlayer)
    await store.resetAll()
  } else {
    if (store.projectConfig.mode === 'FREE') {
       await changePlayer(1)
       await store.resetAll()
    } else {
       showAllDoneDialog.value = true
    }
  }
}

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

const continueLoopMatch = async () => {
  showAllDoneDialog.value = false
  if (store.projectConfig.mode === 'FREE') {
      await changePlayer(1)
  } else {
      const firstPlayer = currentGroupPlayers.value[0]
      if (firstPlayer) {
          await switchContext(firstPlayer)
          await store.resetAll()
      }
  }
}

const finishMatch = () => { showAllDoneDialog.value = false; emit('stop') }

// 【关键修改】统一切换选手逻辑，支持自由模式自动新建
const changePlayer = async (delta) => {
  const groupName = store.currentContext.groupName
  const group = store.projectConfig.groups.find(g => g.name === groupName)
  if (!group || !group.players) return

  const nextIdx = (currentIdx.value === -1 ? 0 : currentIdx.value) + delta

  if (nextIdx >= group.players.length) {
    // 自由模式下，向后溢出则新建
    if (store.projectConfig.mode === 'FREE') {
      const newPlayerName = `Player ${group.players.length + 1}`
      group.players.push(newPlayerName)
      await store.updateGroups(store.projectConfig.groups)
      await store.setMatchContext(groupName, newPlayerName)
      // 切换到新选手并重置
      await store.resetAll()
    }
    // 赛事模式下，不做循环，停在最后
  } else if (nextIdx < 0) {
      // 向前溢出，循环到最后一个
      const target = group.players[group.players.length - 1]
      await store.setMatchContext(groupName, target)
      await store.resetAll()
  } else {
      // 正常切换
      const target = group.players[nextIdx]
      await store.setMatchContext(groupName, target)
      await store.resetAll()
  }
}

const switchContext = async (name) => { await store.setMatchContext(store.currentContext.groupName, name) }
const handleResetOnly = async () => { if (confirm("Reset current scores to ZERO?")) await store.resetAll() }

// 【关键修改】修复 manualChange，在自由模式向后切换时使用 changePlayer 以支持新建
const manualChange = async (delta) => {
    // 只有在自由模式下且是"下一个"时，使用 changePlayer 触发新建逻辑
    if (store.projectConfig.mode === 'FREE' && delta > 0) {
        await changePlayer(delta)
    } else {
        // 其他情况（如向前翻页，或赛事模式）保持原来的循环/列表逻辑
        // 但为了统一体验，这里我们也统一调用 changePlayer 即可，因为 changePlayer 内部已经处理了边界
        await changePlayer(delta)
    }
}

const onSelectPlayer = async (e) => { await switchContext(e.target.value); await store.resetAll() }

const handleGlobalKeydown = (e) => {
  const shortcut = store.appSettings.reset_shortcut || "Ctrl+G"
  const parts = shortcut.toUpperCase().split('+')
  const needCtrl = parts.includes('CTRL')
  const needShift = parts.includes('SHIFT')
  const needAlt = parts.includes('ALT')
  const keyPart = parts.find(p => !['CTRL', 'SHIFT', 'ALT'].includes(p))
  if (!keyPart) return
  const keyPressed = e.key.toUpperCase()
  if (e.ctrlKey === needCtrl && e.shiftKey === needShift && e.altKey === needAlt && keyPressed === keyPart) {
    e.preventDefault()
    handleNextClick()
  }
}

const openWindowSelector = async () => { windowList.value = await store.fetchWindows(); showWindowSelector.value = true }

const confirmOverlay = async () => {
  if (!selectedTargetWindow.value) return
  let targetBounds = null
  if (selectedTargetWindow.value !== "FULL_SCREEN") { const res = await store.getWindowBounds(selectedTargetWindow.value); if (res.found) targetBounds = res.bounds }
  showWindowSelector.value = false
  if (window.electron && window.electron.ipcRenderer) {
    const initialState = {
      referees: JSON.parse(JSON.stringify(store.referees)),
      context: JSON.parse(JSON.stringify(store.currentContext)),
      projectConfig: JSON.parse(JSON.stringify(store.projectConfig))
    }
    window.electron.ipcRenderer.send('open-overlay', { bounds: targetBounds, initialState: initialState })
  }
}
</script>

<style scoped lang="scss">
/* 保持原有样式，省略 */
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
.shortcut-hint { font-size: 0.75rem; opacity: 0.8; font-weight: normal; margin-left: 4px; }
</style>
