<template>
  <div class="score-board">
    <div class="header">

      <div class="header-section left">
        <button class="btn-tool btn-stop" @click="$emit('stop')">
          <ArrowLeft :size="18" />
          <span>{{ $t('sb_btn_stop') }}</span>
        </button>
      </div>

      <div class="header-section center">
        <div class="group-label">{{ store.currentContext.groupName || $t('wiz_mode_free') }}</div>

        <div class="player-navigator">
          <button class="nav-arrow" @click="manualChange(-1)">◀</button>
          <div class="select-wrapper">
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
          </div>
          <button class="nav-arrow" @click="manualChange(1)">▶</button>
        </div>
      </div>

      <div class="header-section right">

        <button
          class="btn-tool btn-auto"
          :class="{ active: isAutoNext }"
          @click="isAutoNext = !isAutoNext"
          :title="$t('chk_auto_next')"
        >
          <Zap :size="16" :class="{ 'icon-active': isAutoNext }" />
          <span>{{ $t('sb_lbl_auto') }}</span>
          <div class="status-dot" v-if="isAutoNext"></div>
        </button>

        <div class="divider-vertical"></div>

        <button class="btn-tool btn-overlay" @click="openWindowSelector">
          <Monitor :size="16" />
          <span>{{ $t('sb_btn_overlay') }}</span>
        </button>

        <button class="btn-tool btn-next" @click="handleNextClick">
          <span class="btn-text">
            {{ isAllDone ? $t('sb_btn_finish') : '⏭ ' + $t('sb_btn_next') }}
          </span>
          <span class="shortcut-tag" v-if="store.appSettings.reset_shortcut && isAutoNext">
            {{ store.appSettings.reset_shortcut }}
          </span>
        </button>

        <button class="btn-tool btn-zero" @click="handleResetOnly" :title="$t('sb_btn_zero')">
          <RotateCcw :size="16" />
          <span class="shortcut-tag warning" v-if="store.appSettings.reset_shortcut && !isAutoNext">
            {{ store.appSettings.reset_shortcut }}
          </span>
        </button>
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
        <h3>{{ $t('sb_title_sel_win') }}</h3>
        <select v-model="selectedTargetWindow" class="win-select">
          <option value="" disabled>{{ $t('sb_opt_sel_app') }}</option>
          <option value="FULL_SCREEN">{{ $t('sb_opt_full_screen') }}</option>
          <option v-for="w in windowList" :key="w" :value="w">{{ w }}</option>
        </select>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showWindowSelector = false">{{ $t('btn_cancel') }}</button>
          <button class="btn-confirm" @click="confirmOverlay">{{ $t('sb_btn_start_overlay') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showResetDialog" class="modal-overlay">
      <div class="modal-content">
        <h3>{{ $t('sb_title_confirm_next') }}</h3>
        <p>{{ $t('sb_msg_confirm_next') }}</p>
        <label class="dont-ask-label"><input type="checkbox" v-model="dontAskAgainTemp"> {{ $t('sb_lbl_dont_ask') }}</label>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showResetDialog = false">{{ $t('btn_cancel') }}</button>
          <button class="btn-confirm" @click="confirmSmartNext">{{ $t('sb_btn_confirm') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showAllDoneDialog" class="modal-overlay">
      <div class="modal-content">
        <h3>{{ $t('sb_title_all_scored') }}</h3>
        <p>{{ $t('sb_msg_all_scored') }}</p>
        <p v-if="store.projectConfig.mode==='TOURNAMENT'" style="font-size:0.9rem;color:#aaa">{{ $t('sb_msg_rejudge') }}</p>
        <div class="modal-actions vertical-actions">
          <button class="btn-confirm large" @click="finishMatch">{{ $t('sb_btn_save_exit') }}</button>
          <button class="btn-cancel large" @click="continueLoopMatch">
             {{ store.projectConfig.mode==='FREE' ? $t('sb_btn_cont_add') : $t('sb_btn_cont_start_over') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'
import { useI18n } from 'vue-i18n'
// 引入新的图标
import { ArrowLeft, Zap, Monitor, RotateCcw } from 'lucide-vue-next'

const emit = defineEmits(['stop'])
const store = useRefereeStore()
const { t } = useI18n()

const isAutoNext = ref(true)
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
    const currentName = store.currentContext.contestantName
    if (currentName && !store.scoredPlayers.has(currentName)) {
      return
    }
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

const changePlayer = async (delta) => {
  const groupName = store.currentContext.groupName
  const group = store.projectConfig.groups.find(g => g.name === groupName)
  if (!group || !group.players) return
  const nextIdx = (currentIdx.value === -1 ? 0 : currentIdx.value) + delta
  if (nextIdx >= group.players.length) {
    if (store.projectConfig.mode === 'FREE') {
      const newPlayerName = `Player ${group.players.length + 1}`
      group.players.push(newPlayerName)
      await store.updateGroups(store.projectConfig.groups)
      await store.setMatchContext(groupName, newPlayerName)
      await store.resetAll()
    }
  } else if (nextIdx < 0) {
      const target = group.players[group.players.length - 1]
      await store.setMatchContext(groupName, target)
      await store.resetAll()
  } else {
      const target = group.players[nextIdx]
      await store.setMatchContext(groupName, target)
      await store.resetAll()
  }
}

const switchContext = async (name) => { await store.setMatchContext(store.currentContext.groupName, name) }
const handleResetOnly = async () => { if (confirm(t('sb_msg_reset_zero'))) await store.resetAll() }

const manualChange = async (delta) => {
    await changePlayer(delta)
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
    if (isAutoNext.value) {
      handleNextClick()
    } else {
      handleResetOnly()
    }
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
.score-board { height: 100%; display: flex; flex-direction: column; background: transparent; }

/* 头部布局优化 */
.header {
  height: 72px; /* 稍微增加高度 */
  background: #1e1e1e;
  border-bottom: 1px solid #333;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  flex-shrink: 0;
  gap: 20px;
}

/* 区域划分 */
.header-section { display: flex; align-items: center; height: 100%; }
.header-section.left { width: 120px; } /* 固定左侧宽度 */
.header-section.center { flex: 1; justify-content: center; gap: 15px; min-width: 0; }
.header-section.right { justify-content: flex-end; gap: 12px; } /* 使用 gap 替代 margin */

/* 通用按钮样式 */
.btn-tool {
  height: 36px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #2b2b2b;
  color: #eee;
  font-size: 0.9rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: #383838;
    border-color: #555;
  }
  &:active {
    transform: translateY(1px);
  }
}

/* 左侧停止按钮 */
.btn-stop {
  background: transparent;
  border: 1px solid #444;
  color: #aaa;
  &:hover { color: #fff; border-color: #666; background: #333; }
}

/* 中间导航条 */
.player-navigator {
  display: flex;
  align-items: center;
  background: #111;
  border-radius: 6px;
  border: 1px solid #333;
  padding: 3px;
  height: 38px;
}
.nav-arrow {
  background: transparent;
  border: none;
  color: #666;
  width: 30px;
  height: 100%;
  cursor: pointer;
  border-radius: 4px;
  &:hover { background: #222; color: #fff; }
}
.select-wrapper { position: relative; margin: 0 5px; }
.player-select {
  background: transparent;
  color: white;
  border: none;
  font-size: 1.1rem;
  font-weight: bold;
  text-align: center;
  outline: none;
  appearance: none;
  cursor: pointer;
  min-width: 120px;
  padding: 0 10px;

  option { background: #333; }
  option.option-scored { color: #2ecc71; }
}

/* --- 右侧按钮特定样式 --- */

/* 1. 自动切换按钮 (Auto) */
.btn-auto {
  background: #252526;
  border: 1px solid #444;
  position: relative;

  /* 激活态 */
  &.active {
    background: rgba(46, 204, 113, 0.15);
    border-color: #2ecc71;
    color: #2ecc71;

    .status-dot {
      background: #2ecc71;
      box-shadow: 0 0 8px rgba(46, 204, 113, 0.6);
    }
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-left: 2px;
  }
}

.divider-vertical { width: 1px; height: 24px; background: #333; margin: 0 4px; }

/* 2. 悬浮窗按钮 */
.btn-overlay {
  background: #2980b9;
  color: white;
  &:hover { background: #3498db; }
}

/* 3. 下一位按钮 (Next) */
.btn-next {
  background: #27ae60;
  color: white;
  min-width: 130px; /* 【核心优化】固定最小宽度，防止文字变化导致抖动 */
  justify-content: center;
  position: relative;
  &:hover { background: #2ecc71; }
}

/* 4. 归零按钮 (Zero) */
.btn-zero {
  background: rgba(192, 57, 43, 0.2);
  color: #e74c3c;
  border: 1px solid rgba(192, 57, 43, 0.4);
  padding: 0 10px;
  min-width: 50px; /* 归零按钮较小 */
  justify-content: center;
  position: relative;
  &:hover { background: #c0392b; color: white; }
}

/* 快捷键标签 (Badge) */
.shortcut-tag {
  position: absolute;
  top: -8px;
  right: -5px;
  font-size: 0.65rem;
  background: #111;
  color: #aaa;
  border: 1px solid #444;
  padding: 1px 4px;
  border-radius: 3px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);

  &.warning {
    border-color: #c0392b;
    color: #e74c3c;
  }
}

/* 计分卡区域 (保持原样) */
.panels-container { flex: 1; padding: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); grid-auto-rows: max-content; gap: 15px; overflow-y: auto; align-content: start; }
.score-card { background: #ecf0f1; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 8px rgba(0,0,0,0.2); color: #2c3e50; .card-top { width: 100%; display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 0.9rem; font-weight: bold; } .status-indicators { display: flex; gap: 4px; } .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #bdc3c7; &.connected { background: #2ecc71; } } .score-main { font-size: 4rem; font-weight: 800; line-height: 1; margin: 10px 0; } .score-detail { font-size: 1rem; color: #666; background: #ddd; padding: 2px 10px; border-radius: 10px; } }

/* 弹窗样式 (保持原样) */
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 2000; }
.modal-content { background: #2b2b2b; padding: 25px; border-radius: 8px; width: 380px; text-align: center; color: white; h3 { margin-top: 0; } }
.modal-actions { display: flex; justify-content: center; gap: 10px; margin-top: 20px; }
.vertical-actions { flex-direction: column; }
.btn-confirm { background: #3498db; color: white; padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; }
.btn-cancel { background: #555; color: white; padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; }
.large { width: 100%; margin-bottom: 10px; padding: 12px; font-size: 1rem; }
.win-select { width: 100%; padding: 8px; margin: 15px 0; background: #111; color: white; border: 1px solid #444; }
.dont-ask-label { display: block; margin-top: 15px; color: #aaa; cursor: pointer; input { margin-right: 5px; } }
</style>
