<template>
  <div class="score-board">
    <div class="header">

      <div class="header-section left">
        <button class="btn-tool btn-stop" @click="showExitDialog = true">
          <ArrowLeft :size="18" />
          <span>{{ $t('sb_btn_stop') }}</span>
        </button>
      </div>

      <div class="header-section center">
        <div class="match-context-label">
          <div class="stage-attempt-label">
            <Layers3 :size="14" />
            <span>{{ competitionStore.activeStage?.name }}</span>
            <span class="context-separator">/</span>
            <span>{{ $t('attempt_label', { number: competitionStore.activeAttemptNumber }) }}</span>
          </div>
          <div class="group-label">{{ store.currentContext.groupName || $t('wiz_mode_free') }}</div>
        </div>

        <div class="player-navigator">
          <button class="nav-arrow" :disabled="isContextChanging" @click="manualChange(-1)">◀</button>
          <div class="select-wrapper">
            <select class="player-select" :value="store.currentContext.contestantName" :disabled="isContextChanging" @change="onSelectPlayer">
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
          <button class="nav-arrow" :disabled="isContextChanging" @click="manualChange(1)">▶</button>
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
          <div class="status-dot"></div>
        </button>

        <div class="divider-vertical"></div>

        <button class="btn-tool btn-overlay" @click="openPresentationSelector()">
          <PictureInPicture2 :size="16" />
          <span>{{ $t('sb_btn_overlay') }}</span>
        </button>

        <button class="btn-tool btn-next" :disabled="isContextChanging" @click="handleNextClick">
          <span class="btn-text">
            {{ isAllDone ? $t('sb_btn_finish') : '⏭ ' + $t('sb_btn_next') }}
          </span>
          <span class="shortcut-tag" v-if="settingsStore.appSettings.reset_shortcut && isAutoNext">
            {{ settingsStore.appSettings.reset_shortcut }}
          </span>
        </button>

        <button class="btn-tool btn-zero" :disabled="isContextChanging" @click="handleResetOnly" :title="$t('sb_btn_zero')">
          <RotateCcw :size="16" />
          <span class="shortcut-tag warning" v-if="settingsStore.appSettings.reset_shortcut && !isAutoNext">
            {{ settingsStore.appSettings.reset_shortcut }}
          </span>
        </button>
      </div>
    </div>

    <div class="match-health-bar" role="status" aria-live="polite">
      <span class="health-item" :class="store.matchStatus.persistence">
        <Database :size="14" />
        {{ $t(`match_persistence_${store.matchStatus.persistence}`) }}
      </span>
      <span class="health-item" :class="store.matchStatus.worker">
        <Cpu :size="14" />
        {{ $t(`match_worker_${store.matchStatus.worker}`) }}
      </span>
      <button
        v-if="store.matchStatus.worker === 'error'"
        class="health-retry"
        type="button"
        :disabled="isRetryingWorker"
        :title="$t(isRetryingWorker ? 'status_retrying_worker' : 'btn_retry_worker')"
        :aria-label="$t(isRetryingWorker ? 'status_retrying_worker' : 'btn_retry_worker')"
        @click="retryPlatformWorker"
      >
        <RotateCcw :size="14" :class="{ spinning: isRetryingWorker }" />
      </button>
      <span class="health-item" :class="store.matchStatus.media">
        <Video :size="14" />
        {{ $t(`match_media_${store.matchStatus.media}`) }}
      </span>
      <code v-if="contextSwitchError || store.matchStatus.errorCode" class="health-error">
        {{ contextSwitchError || store.matchStatus.errorCode }}
      </code>
    </div>

    <div v-if="showVideoWorkspace" class="video-workspace">
      <div class="video-workspace-toolbar">
        <button class="workspace-icon-button" :title="$t('media_exit_player')" @click="showVideoWorkspace = false">
          <ArrowLeft :size="17" />
        </button>
        <div class="workspace-title">
          <Youtube :size="18" />
          <span>{{ $t('media_video_scoring') }}</span>
        </div>
        <ScoreDisplayModeSwitch v-model="videoDisplayMode" />
        <button class="workspace-icon-button" :title="$t('media_change_video')" @click="openPresentationSelector('video')">
          <Link2 :size="17" />
        </button>
      </div>
      <div class="video-score-layout">
        <section class="workspace-player">
          <YouTubePlayer
            :video-id="currentVideoId"
            :group="store.currentContext.groupName"
            :contestant="store.currentContext.contestantName"
            :empty-text="$t('media_empty')"
            :open-text="$t('media_open_browser')"
            sync-enabled
            @sync="store.syncMediaPlayback"
          />
          <button v-if="!currentVideoId" class="bind-video-command" @click="openPresentationSelector('video')">
            <Link2 :size="16" />
            {{ $t('media_bind_video') }}
          </button>
        </section>
        <ScoreOverlayPanel
          :referees="store.referees"
          :contestant="store.currentContext.contestantName"
          :display-mode="videoDisplayMode"
          :show-header="false"
          draggable
          position-key="video-score-overlay-position"
        />
      </div>
    </div>

    <div v-else class="panels-container">
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

          <template v-if="ref.mode === 'DUAL' && ref.penalty > 0">
            / <span class="penalty-text">-{{ ref.penalty }}</span>
          </template>
        </div>
      </div>
    </div>

    <DialogShell
      :open="showWindowSelector"
      :aria-label="$t('media_choose_presentation')"
      width="520px"
      padding="0"
      variant="workbench"
      allow-overflow
      :close-on-backdrop="false"
      @close="showWindowSelector = false"
    >
      <div class="modal-content presentation-dialog">
        <h3>{{ $t('media_choose_presentation') }}</h3>
        <div class="presentation-modes">
          <button :class="{ active: presentationMode === 'window' }" @click="selectPresentationMode('window')">
            <Monitor :size="18" />
            <span>{{ $t('media_window_overlay') }}</span>
          </button>
          <button :class="{ active: presentationMode === 'video' }" @click="selectPresentationMode('video')">
            <Youtube :size="18" />
            <span>{{ $t('media_youtube_scoring') }}</span>
          </button>
        </div>

        <div v-if="presentationMode === 'window'" class="window-picker">
          <button
            class="win-select"
            type="button"
            :aria-expanded="windowPickerOpen"
            aria-haspopup="listbox"
            @click="windowPickerOpen = !windowPickerOpen"
            @keydown.esc.stop="windowPickerOpen = false"
          >
            <span :class="{ placeholder: !selectedTargetWindow }">{{ selectedTargetWindowLabel }}</span>
            <ChevronDown :size="16" aria-hidden="true" />
          </button>
          <div v-if="windowPickerOpen" class="window-option-list" role="listbox" :aria-label="$t('sb_opt_sel_app')">
            <button
              v-for="option in windowOptions"
              :key="option.value"
              type="button"
              role="option"
              :aria-selected="selectedTargetWindow === option.value"
              :class="{ selected: selectedTargetWindow === option.value }"
              :title="option.label"
              @click="selectTargetWindow(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div v-else class="video-binding-form">
          <label>{{ store.currentContext.contestantName }}</label>
          <input
            v-model="videoUrl"
            type="url"
            :placeholder="$t('media_url_placeholder')"
            :disabled="!store.currentContext.contestantName"
            @keyup.enter="confirmPresentation"
          />
          <span v-if="mediaSaved" class="media-saved">{{ $t('media_saved') }}</span>
          <span v-if="mediaError" class="media-error">{{ mediaError }}</span>
        </div>

        <div class="modal-actions">
          <button class="btn-cancel" @click="showWindowSelector = false">{{ $t('btn_cancel') }}</button>
          <button
            class="btn-confirm"
            :disabled="savingMedia || !canConfirmPresentation"
            @click="confirmPresentation"
          >
            {{ presentationMode === 'video' ? $t('media_enter_player') : $t('sb_btn_start_overlay') }}
          </button>
        </div>
      </div>
    </DialogShell>

    <DialogShell
      :open="showResetDialog"
      :aria-label="$t('sb_title_confirm_next')"
      width="380px"
      padding="0"
      variant="workbench"
      :close-on-backdrop="false"
      @close="showResetDialog = false"
    >
      <div class="modal-content">
        <h3>{{ $t('sb_title_confirm_next') }}</h3>
        <p>{{ $t('sb_msg_confirm_next') }}</p>
        <label class="dont-ask-label"><input type="checkbox" v-model="dontAskAgainTemp"> {{ $t('sb_lbl_dont_ask') }}</label>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showResetDialog = false">{{ $t('btn_cancel') }}</button>
          <button class="btn-confirm" @click="confirmSmartNext">{{ $t('sb_btn_confirm') }}</button>
        </div>
      </div>
    </DialogShell>

    <DialogShell
      :open="showExitDialog"
      :aria-label="$t('sb_title_end_match')"
      width="380px"
      padding="0"
      variant="workbench"
      :close-on-backdrop="false"
      @close="showExitDialog = false"
    >
      <div class="modal-content">
        <h3>{{ $t('sb_title_end_match') }}</h3>
        <p>{{ $t('sb_msg_end_match') }}</p>
        <div class="modal-actions vertical-actions">
          <button class="btn-confirm large" @click="confirmStopMatch">{{ $t('sb_btn_save_end') }}</button>
          <button class="btn-invalidate large" @click="openInvalidateDialog">
            <Ban :size="16" /> {{ $t('sb_btn_invalidate') }}
          </button>
          <button class="btn-cancel large" @click="showExitDialog = false">{{ $t('btn_cancel') }}</button>
        </div>
      </div>
    </DialogShell>

    <DialogShell
      :open="showInvalidateDialog"
      :aria-label="$t('sb_title_invalidate')"
      width="380px"
      padding="0"
      variant="workbench"
      :close-on-backdrop="false"
      @close="showInvalidateDialog = false"
    >
      <div class="modal-content">
        <h3>{{ $t('sb_title_invalidate') }}</h3>
        <p>{{ $t('sb_msg_invalidate') }}</p>
        <div class="invalidate-context">
          <strong>{{ store.currentContext.contestantName }}</strong>
          <span>{{ competitionStore.activeStage?.name }} / {{ $t('attempt_label', { number: competitionStore.activeAttemptNumber }) }}</span>
          <span>{{ store.currentContext.groupName }}</span>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showInvalidateDialog = false">{{ $t('btn_cancel') }}</button>
          <button class="btn-confirm warning" @click="confirmInvalidateMatch">{{ $t('sb_btn_confirm_invalidate') }}</button>
        </div>
      </div>
    </DialogShell>

    <DialogShell
      :open="showZeroDialog"
      :aria-label="$t('sb_btn_zero')"
      width="380px"
      padding="0"
      variant="workbench"
      :close-on-backdrop="false"
      @close="showZeroDialog = false"
    >
      <div class="modal-content">
        <h3>{{ $t('sb_btn_zero') }}</h3>
        <p>{{ $t('sb_msg_reset_zero') }}</p>
        <label class="dont-ask-label">
          <input type="checkbox" v-model="dontAskZeroTemp">
          {{ $t('sb_lbl_dont_ask') }}
        </label>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showZeroDialog = false">{{ $t('btn_cancel') }}</button>
          <button class="btn-confirm warning" @click="confirmZeroReset">{{ $t('sb_btn_confirm') }}</button>
        </div>
      </div>
    </DialogShell>

    <DialogShell
      :open="showAllDoneDialog"
      :aria-label="$t('sb_title_all_scored')"
      width="380px"
      padding="0"
      variant="workbench"
      :close-on-backdrop="false"
      @close="showAllDoneDialog = false"
    >
      <div class="modal-content">
        <h3>{{ $t('sb_title_all_scored') }}</h3>
        <p>{{ $t('sb_msg_all_scored') }}</p>
        <p v-if="competitionStore.projectConfig.mode==='TOURNAMENT'" style="font-size:0.9rem;color:#aaa">{{ $t('sb_msg_rejudge') }}</p>
        <div class="modal-actions vertical-actions">
          <button class="btn-confirm large" @click="finishMatch">{{ $t('sb_btn_save_exit') }}</button>
          <button class="btn-cancel large" @click="continueLoopMatch">
             {{ competitionStore.projectConfig.mode==='FREE' ? $t('sb_btn_cont_add') : $t('sb_btn_cont_start_over') }}
          </button>
        </div>
      </div>
    </DialogShell>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue' // 引入 watch
import { useCompetitionStore } from '../stores/competitionStore'
import { useDeviceStore } from '../stores/deviceStore'
import { useMatchStore } from '../stores/matchStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Ban, ChevronDown, Cpu, Database, Layers3, Link2, Monitor, PictureInPicture2, RotateCcw, Video, Youtube, Zap } from 'lucide-vue-next'
import ScoreOverlayPanel from './ScoreOverlayPanel.vue'
import ScoreDisplayModeSwitch from './ScoreDisplayModeSwitch.vue'
import YouTubePlayer from './YouTubePlayer.vue'
import DialogShell from './DialogShell.vue'
import { normalizeYouTubeUrl } from '../media/youtube'

const emit = defineEmits(['stop', 'invalidate'])
const store = useMatchStore()
const competitionStore = useCompetitionStore()
const deviceStore = useDeviceStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

// 状态定义
const isAutoNext = ref(true)
const showResetDialog = ref(false)
const showZeroDialog = ref(false)
const showAllDoneDialog = ref(false)
const showExitDialog = ref(false)
const showInvalidateDialog = ref(false)
const dontAskAgainTemp = ref(false)
const dontAskZeroTemp = ref(false)
const showWindowSelector = ref(false)
const windowList = ref([])
const selectedTargetWindow = ref("")
const windowPickerOpen = ref(false)
const presentationMode = ref('window')
const showVideoWorkspace = ref(false)
const videoDisplayMode = ref('COMBINED')
const videoUrl = ref('')
const savingMedia = ref(false)
const mediaError = ref('')
const mediaSaved = ref(false)
const isContextChanging = ref(false)
const isRetryingWorker = ref(false)
const contextSwitchError = ref('')

const retryPlatformWorker = async () => {
  if (isRetryingWorker.value) return
  isRetryingWorker.value = true
  try {
    await deviceStore.retryPlatformWorker()
  } catch (error) {
    console.error('Platform Worker retry failed:', error)
  } finally {
    isRetryingWorker.value = false
  }
}

const currentBinding = computed(() => {
  const group = store.currentContext.groupName
  const contestant = store.currentContext.contestantName
  return competitionStore.projectConfig.media?.[group]?.[contestant] || null
})
const currentVideoId = computed(() => currentBinding.value?.video_id || '')
const windowOptions = computed(() => [
  { value: 'FULL_SCREEN', label: t('sb_opt_full_screen') },
  ...windowList.value.map((item) => ({ value: item.windowId, label: item.title }))
])
const selectedTargetWindowLabel = computed(() =>
  windowOptions.value.find((option) => option.value === selectedTargetWindow.value)?.label || t('sb_opt_sel_app')
)
const canConfirmPresentation = computed(() =>
  presentationMode.value === 'video' ? Boolean(videoUrl.value) : Boolean(selectedTargetWindow.value)
)

watch(
  () => [store.currentContext.groupName, store.currentContext.contestantName, currentBinding.value?.video_id],
  () => {
    videoUrl.value = currentBinding.value?.canonical_url || ''
    mediaError.value = ''
    mediaSaved.value = false
  },
  { immediate: true }
)
watch(showWindowSelector, (open) => { if (!open) windowPickerOpen.value = false })

const saveVideoBinding = async () => {
  if (!store.currentContext.contestantName || !videoUrl.value) return false
  savingMedia.value = true
  mediaError.value = ''
  mediaSaved.value = false
  try {
    const normalized = normalizeYouTubeUrl(videoUrl.value)
    const binding = await store.saveMediaBinding(
      store.currentContext.groupName,
      store.currentContext.contestantName,
      normalized.canonical_url
    )
    videoUrl.value = binding.canonical_url
    mediaSaved.value = true
    return true
  } catch (error) {
    console.debug('Media binding failed', error)
    mediaError.value = t('media_invalid')
    return false
  } finally {
    savingMedia.value = false
  }
}

const currentGroupPlayers = computed(() => {
  const gName = store.currentContext.groupName
  const group = competitionStore.activeGroups.find(g => g.name === gName)
  return group ? group.players : []
})

const currentIdx = computed(() => currentGroupPlayers.value.indexOf(store.currentContext.contestantName))
const isAllDone = computed(() => currentGroupPlayers.value.length > 0 && currentGroupPlayers.value.every(p => store.scoredPlayers.has(p)))
let removeShortcutListener = () => {}

// 执行快捷键动作
const executeShortcutAction = () => {
  if (isContextChanging.value) return
  console.log('Shortcut triggered! Auto mode:', isAutoNext.value)
  if (isAutoNext.value) {
    handleNextClick()
  } else {
    handleResetOnly()
  }
}

// 封装注册逻辑
const registerShortcut = async (shortcut) => {
  if (window.ftEngine?.shortcuts && shortcut) {
    console.log('[ScoreBoard] Registering shortcut:', shortcut)
    const result = await window.ftEngine.shortcuts.register(shortcut)
    if (!result?.ok) console.warn('[ScoreBoard] Shortcut unavailable:', result?.error)
  }
}

onMounted(async () => {
  await settingsStore.fetchSettings()

  if (store.currentContext.groupName) {
    if (!store.currentContext.contestantName && currentGroupPlayers.value.length > 0) {
      await switchContext(currentGroupPlayers.value[0])
    }
    await store.fetchScoredPlayers(store.currentContext.groupName)
    initResumeState()
  }

  // 1. 初始注册
  const initialShortcut = settingsStore.appSettings.reset_shortcut || "Ctrl+G"
  await registerShortcut(initialShortcut)

  // 监听触发
  if (window.ftEngine?.shortcuts) {
    removeShortcutListener = window.ftEngine.shortcuts.onTriggered(executeShortcutAction)
  }

  window.addEventListener('keydown', handleGlobalKeydown)
})

// 【新增】监听设置变化，实时更新快捷键
watch(() => settingsStore.appSettings.reset_shortcut, (newVal, oldVal) => {
  if (newVal && newVal !== oldVal) {
    void registerShortcut(newVal)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)

  if (window.ftEngine) {
    // 2. 退出时注销
    window.ftEngine.shortcuts.unregister()
    removeShortcutListener()
    window.ftEngine.overlay.close()
  }
  if (store.matchActive) void store.stopMatch()
})

// ... (以下逻辑保持不变)

const initResumeState = async () => {
  if (isAllDone.value) {
    if (competitionStore.projectConfig.mode === 'FREE') {
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
  if (isContextChanging.value) return
  if (settingsStore.appSettings.suppress_reset_confirm || isAutoNext.value) confirmSmartNext()
  else { dontAskAgainTemp.value = false; showResetDialog.value = true }
}

const confirmSmartNext = async () => {
  if (dontAskAgainTemp.value) settingsStore.updateSetting('suppress_reset_confirm', true)
  showResetDialog.value = false
  const currentName = store.currentContext.contestantName
  store.broadcastPlayerScored(currentName)

  const nextPlayer = findNextUnscoredPlayer()
  if (nextPlayer) {
    await switchContext(nextPlayer)
  } else {
    if (competitionStore.projectConfig.mode === 'FREE') {
       await changePlayer(1)
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
  if (competitionStore.projectConfig.mode === 'FREE') {
      await changePlayer(1)
  } else {
      const firstPlayer = currentGroupPlayers.value[0]
      if (firstPlayer) {
          await switchContext(firstPlayer)
      }
  }
}

const finishMatch = () => { showAllDoneDialog.value = false; emit('stop') }

const confirmStopMatch = () => {
  showExitDialog.value = false
  emit('stop')
}

const openInvalidateDialog = () => {
  showExitDialog.value = false
  showInvalidateDialog.value = true
}

const confirmInvalidateMatch = () => {
  showInvalidateDialog.value = false
  emit('invalidate')
}

const changePlayer = async (delta) => {
  const groupName = store.currentContext.groupName
  const group = competitionStore.activeGroups.find(g => g.name === groupName)
  if (!group || !group.players) return
  const baseIndex = currentIdx.value === -1 ? (delta > 0 ? -1 : 0) : currentIdx.value
  const nextIdx = baseIndex + delta
  if (nextIdx >= group.players.length) {
    if (competitionStore.projectConfig.mode === 'FREE') {
      const newPlayerName = `Player ${group.players.length + 1}`
      try {
        await competitionStore.appendFreeContestant(groupName, newPlayerName)
        await switchContext(newPlayerName)
      } catch (error) {
        contextSwitchError.value =
          error && typeof error === 'object' && typeof error.code === 'string'
            ? error.code
            : 'MATCH_CONTEXT_INVALID'
        console.error('Append free contestant failed:', error)
      }
    }
  } else if (nextIdx < 0) {
      const target = group.players[group.players.length - 1]
      await switchContext(target)
  } else {
      const target = group.players[nextIdx]
      await switchContext(target)
  }
}

const switchContext = async (name) => {
  if (isContextChanging.value || !name) return false
  if (name === store.currentContext.contestantName) return true
  isContextChanging.value = true
  try {
    await store.setMatchContext(store.currentContext.groupName, name)
    contextSwitchError.value = ''
    return true
  } catch (error) {
    contextSwitchError.value =
      error && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : 'MATCH_CONTEXT_INVALID'
    console.error('Switch match context failed:', error)
    return false
  } finally {
    isContextChanging.value = false
  }
}

const handleResetOnly = () => {
  if (isContextChanging.value) return
  if (settingsStore.appSettings.suppress_zero_confirm) {
    confirmZeroReset()
  } else {
    dontAskZeroTemp.value = false
    showZeroDialog.value = true
  }
}

const confirmZeroReset = async () => {
  if (dontAskZeroTemp.value) {
    settingsStore.updateSetting('suppress_zero_confirm', true)
  }
  showZeroDialog.value = false
  await store.resetAll()
}

const manualChange = async (delta) => {
    await changePlayer(delta)
}

const onSelectPlayer = async (event) => {
  const select = event.currentTarget
  const switched = await switchContext(select.value)
  if (!switched) select.value = store.currentContext.contestantName
}

const handleGlobalKeydown = (e) => {
  const shortcut = settingsStore.appSettings.reset_shortcut || "Ctrl+G"
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

const selectPresentationMode = async (mode) => {
  presentationMode.value = mode
  windowPickerOpen.value = false
  mediaError.value = ''
  if (mode === 'window' && windowList.value.length === 0) {
    windowList.value = await deviceStore.fetchWindows()
  }
}
const selectTargetWindow = (value) => {
  selectedTargetWindow.value = value
  windowPickerOpen.value = false
}

const openPresentationSelector = async (mode = null) => {
  const targetMode = mode || (showVideoWorkspace.value ? 'video' : presentationMode.value)
  await selectPresentationMode(targetMode)
  videoUrl.value = currentBinding.value?.canonical_url || ''
  mediaSaved.value = false
  showWindowSelector.value = true
}

const confirmPresentation = async () => {
  if (presentationMode.value === 'video') {
    const saved = await saveVideoBinding()
    if (!saved) return
    showWindowSelector.value = false
    showVideoWorkspace.value = true
    return
  }
  await confirmOverlay()
}

const confirmOverlay = async () => {
  if (!selectedTargetWindow.value) return
  let targetBounds = null
  if (selectedTargetWindow.value !== "FULL_SCREEN") { const res = await deviceStore.getWindowBounds(selectedTargetWindow.value); if (res.found) targetBounds = res.bounds }
  showWindowSelector.value = false
  if (window.ftEngine?.overlay) {
    const initialState = {
      referees: JSON.parse(JSON.stringify(store.referees)),
      context: JSON.parse(JSON.stringify(store.currentContext)),
      projectConfig: JSON.parse(JSON.stringify(competitionStore.projectConfig)),
      stages: JSON.parse(JSON.stringify(competitionStore.stages)),
      activeStageId: competitionStore.activeStageId,
      activeAttemptNumber: competitionStore.activeAttemptNumber
    }
    window.ftEngine.overlay.open({ bounds: targetBounds, initialState: initialState })
  }
}
</script>

<style scoped lang="scss">
/* 保持原有样式不变 */
.score-board { height: 100%; display: flex; flex-direction: column; background: var(--workbench-bg); color: var(--workbench-text); }
.header { height: 72px; background: var(--workbench-bg); border-bottom: 1px solid var(--workbench-border-subtle); display: flex; align-items: center; justify-content: space-between; padding: 0 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); flex-shrink: 0; gap: 20px; }
.header-section { display: flex; align-items: center; height: 100%; }
.header-section.left { width: 120px; }
.header-section.center { flex: 1; justify-content: center; gap: 15px; min-width: 0; }
.header-section.right { justify-content: flex-end; gap: 12px; }
.match-context-label { min-width: 120px; max-width: 220px; padding-right: 15px; border-right: 1px solid #444; overflow: hidden; }
.stage-attempt-label { display: flex; align-items: center; gap: 5px; color: var(--workbench-muted-strong); font-size: 0.72rem; white-space: nowrap; overflow: hidden; span { overflow: hidden; text-overflow: ellipsis; } .context-separator { flex: 0 0 auto; color: var(--workbench-muted); } }
.group-label { margin-top: 3px; color: #aaa; font-size: 0.84rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.match-health-bar { min-height: 32px; flex-shrink: 0; display: flex; align-items: center; gap: 18px; padding: 0 20px; border-bottom: 1px solid var(--workbench-border-subtle); background: var(--workbench-surface); color: var(--workbench-muted-strong); font-size: 0.75rem; overflow-x: auto; }
.health-item { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; color: #9ea3aa; }
.health-item.saved, .health-item.ready, .health-item.aligned { color: #6fc596; }
.health-item.saving, .health-item.reconnecting, .health-item.stale, .health-item.context_mismatch, .health-item.not_ready { color: #d8b667; }
.health-item.error { color: #ef8888; }
.health-retry { width: 26px; height: 26px; flex: 0 0 26px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #784949; border-radius: 4px; background: #342527; color: #ef9a9a; cursor: pointer; }
.health-retry:hover:not(:disabled) { border-color: #b25d5d; background: #472c2f; color: white; }
.health-retry:disabled { opacity: 0.6; cursor: wait; }
.health-retry .spinning { animation: worker-spin 0.8s linear infinite; }
.health-error { min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ef8888; font-size: 0.7rem; }
.btn-tool { height: 36px; padding: 0 12px; border: 1px solid transparent; border-radius: 6px; background: var(--workbench-surface-raised); color: var(--workbench-text); font-size: 0.9rem; font-weight: 500; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: all 0.2s ease; &:hover { background: var(--workbench-surface-hover); border-color: var(--workbench-border); } &:active { transform: translateY(1px); } }
.btn-tool:disabled, .nav-arrow:disabled, .player-select:disabled { opacity: 0.5; cursor: wait; }
.btn-stop { background: transparent; border: 1px solid #444; color: #aaa; &:hover { color: #fff; border-color: #666; background: #333; } }
.player-navigator { display: flex; align-items: center; background: var(--workbench-input); border-radius: 6px; border: 1px solid var(--workbench-border-subtle); padding: 3px; height: 38px; }
.nav-arrow { background: transparent; border: none; color: var(--workbench-muted-strong); width: 30px; height: 100%; cursor: pointer; border-radius: 4px; &:hover { background: var(--workbench-surface-hover); color: var(--workbench-text); } }
.select-wrapper { position: relative; margin: 0 5px; }
.player-select { background: transparent; color: var(--workbench-text); border: none; font-size: 1.1rem; font-weight: bold; text-align: center; outline: none; appearance: none; cursor: pointer; min-width: 120px; padding: 0 10px; option { background: var(--workbench-surface-raised); color: var(--workbench-text); } option.option-scored { color: var(--workbench-success); } }
.btn-auto { background: #252526; border: 1px solid #444; position: relative; .status-dot { width: 6px; height: 6px; border-radius: 50%; margin-left: 4px; background: #444; transition: all 0.3s ease; } &.active { background: rgba(46, 204, 113, 0.15); border-color: #2ecc71; color: #2ecc71; .status-dot { background: #2ecc71; box-shadow: 0 0 6px rgba(46, 204, 113, 0.8); } } }
.divider-vertical { width: 1px; height: 24px; background: #333; margin: 0 4px; }
.btn-overlay { background: var(--workbench-accent); color: white; &:hover { filter: brightness(1.12); } }
.btn-next { background: #27ae60; color: white; min-width: 130px; justify-content: center; position: relative; &:hover { background: #2ecc71; } }
.btn-zero { background: rgba(192, 57, 43, 0.2); color: #e74c3c; border: 1px solid rgba(192, 57, 43, 0.4); padding: 0 10px; min-width: 50px; justify-content: center; position: relative; &:hover { background: #c0392b; color: white; } }
.shortcut-tag { position: absolute; top: -8px; right: -5px; font-size: 0.65rem; background: #111; color: #aaa; border: 1px solid #444; padding: 1px 4px; border-radius: 3px; white-space: nowrap; pointer-events: none; box-shadow: 0 2px 4px rgba(0,0,0,0.3); &.warning { border-color: #c0392b; color: #e74c3c; } }
.panels-container { flex: 1; min-width: 0; padding: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); grid-auto-rows: max-content; gap: 15px; align-content: start; overflow-y: auto; }
.video-workspace { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0; box-sizing: border-box; overflow: hidden; }
.video-workspace-toolbar { position: absolute; top: 14px; left: 16px; right: 16px; z-index: 20; min-height: 36px; display: grid; grid-template-columns: 34px minmax(0, 1fr) auto 34px; align-items: center; gap: 10px; pointer-events: none; }
.video-workspace-toolbar > * { pointer-events: auto; }
.workspace-title { display: flex; align-items: center; justify-content: center; gap: 8px; color: rgba(255, 255, 255, 0.56); font-size: 0.9rem; font-weight: 650; text-shadow: 0 1px 8px rgba(0, 0, 0, 0.7); }
.workspace-icon-button { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: 5px; background: transparent; color: rgba(255, 255, 255, 0.56); cursor: pointer; transition: color 0.16s ease, background-color 0.16s ease; }
.workspace-icon-button:hover, .workspace-icon-button:focus-visible { outline: none; background: rgba(255, 255, 255, 0.12); color: #fff; }
.video-score-layout { position: relative; flex: 1; min-height: 0; display: block; }
.workspace-player { width: 100%; height: 100%; min-width: 0; }
.video-score-layout > .score-overlay-panel { z-index: 10; }
.video-score-layout > .score-overlay-panel :deep(.overlay-score-card) { box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32); }
.bind-video-command { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); width: min(320px, calc(100% - 40px)); min-height: 36px; display: flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--workbench-accent); border-radius: 5px; background: color-mix(in srgb, var(--workbench-accent-soft) 92%, transparent); color: var(--workbench-text); cursor: pointer; }
.score-card { background: #ecf0f1; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 8px rgba(0,0,0,0.2); color: #2c3e50; .card-top { width: 100%; display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 0.9rem; font-weight: bold; } .status-indicators { display: flex; gap: 4px; } .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #bdc3c7; &.connected { background: #2ecc71; } } .score-main { font-size: 4rem; font-weight: 800; line-height: 1; margin: 10px 0; } .score-detail { font-size: 1rem; color: #666; background: #ddd; padding: 2px 10px; border-radius: 10px; } }
.modal-content { background: var(--workbench-surface-raised); padding: 25px; border-radius: 8px; width: min(380px, calc(100vw - 48px)); box-sizing: border-box; text-align: center; color: var(--workbench-text); h3 { margin-top: 0; } }
.presentation-dialog { width: min(520px, calc(100vw - 48px)); box-sizing: border-box; }
.presentation-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
.presentation-modes button { min-height: 68px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; border: 1px solid #484b51; border-radius: 6px; background: #222326; color: #b9bdc4; cursor: pointer; }
.presentation-modes button.active { border-color: var(--workbench-accent); background: var(--workbench-accent-soft); color: var(--workbench-text); }
.video-binding-form { position: relative; display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; text-align: left; }
.video-binding-form label { grid-column: 1 / -1; color: #aeb2b9; font-size: 0.78rem; }
.video-binding-form input { grid-column: 1 / -1; width: 100%; height: 38px; box-sizing: border-box; border: 1px solid #4b4e54; border-radius: 5px; background: #151618; color: #eee; padding: 0 10px; outline: none; }
.video-binding-form input:focus { border-color: #4da3dc; }
.media-saved { color: #45c486; font-size: 0.75rem; }
.media-error { grid-column: 1 / -1; color: #ff8b8b; font-size: 0.76rem; }
.modal-actions { display: flex; justify-content: center; gap: 10px; margin-top: 20px; }
@keyframes worker-spin { to { transform: rotate(360deg); } }
.vertical-actions { flex-direction: column; }
.btn-confirm { background: #3498db; color: white; padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; }
.btn-confirm:disabled { opacity: 0.45; cursor: default; }
.btn-confirm.warning { background: #c0392b; &:hover { background: #e74c3c; } }
.btn-invalidate { display: flex; align-items: center; justify-content: center; gap: 7px; box-sizing: border-box; border: 1px solid #8e4141; border-radius: 4px; background: transparent; color: #ef9b9b; cursor: pointer; }
.btn-invalidate:hover { background: #4a2424; color: white; }
.invalidate-context { margin: 16px 0; padding: 12px; border: 1px solid #464646; background: #222; display: flex; flex-direction: column; gap: 4px; text-align: left; strong { color: white; } span { color: #aaa; font-size: 0.82rem; } }
.btn-cancel { background: #555; color: white; padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; }
.large { width: 100%; margin-bottom: 10px; padding: 12px; font-size: 1rem; }
.window-picker { position: relative; width: 100%; min-width: 0; margin: 15px 0; text-align: left; }
.win-select { width: 100%; min-width: 0; height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 10px; border: 1px solid #444; border-radius: 4px; background: #111; color: white; cursor: pointer; }
.win-select span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.win-select span.placeholder, .win-select svg { color: #8d929b; }
.win-select svg { flex: 0 0 auto; }
.window-option-list { position: absolute; z-index: 4; top: calc(100% + 4px); left: 0; right: 0; width: 100%; max-width: 100%; max-height: min(320px, calc(100vh - 300px)); min-height: 38px; overflow-x: hidden; overflow-y: auto; padding: 4px; border: 1px solid #444; border-radius: 4px; background: #17181a; box-shadow: 0 12px 28px rgba(0, 0, 0, 0.48); }
.window-option-list button { width: 100%; min-width: 0; height: 34px; display: block; overflow: hidden; padding: 0 8px; border: 0; border-radius: 3px; background: transparent; color: #d8dade; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.window-option-list button:hover, .window-option-list button:focus-visible, .window-option-list button.selected { outline: none; background: var(--workbench-accent-soft); color: #fff; }
.dont-ask-label { display: block; margin-top: 15px; color: #aaa; cursor: pointer; input { margin-right: 5px; } }

/* 【修改】重点扣分样式 - 使用与 .btn-zero 相似的醒目红色 */
.penalty-text {
  color: #c0392b;
  font-weight: 800;
}

@media (max-width: 780px) {
  .video-workspace-toolbar { left: 10px; right: 10px; }
  .workspace-title span { display: none; }
}
</style>
