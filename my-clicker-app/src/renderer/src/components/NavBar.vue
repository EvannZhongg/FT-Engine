<template>
  <div class="navbar-container">
    <div class="navbar" @dblclick="maximizeWindow">
      <div class="brand">
        <img src="../assets/icon.png" class="logo-icon" style="width: 24px; height: 24px;" />
        <span class="title">{{ $t('app_title') }}</span>
      </div>

      <div class="right-area">
        <button
          ref="settingsBtnRef"
          class="btn-icon settings-btn"
          @click="toggleSettings"
          :title="$t('nav_settings')"
          :class="{ active: showSettings }"
        >
          <Settings :size="18" />
        </button>

        <div class="window-controls">
          <button class="win-btn" @click="minimizeWindow" :title="$t('nav_minimize')">
            <Minus :size="16" />
          </button>

          <button class="win-btn" @click="maximizeWindow" title="Maximize/Restore">
            <Square :size="14" />
          </button>

          <button class="win-btn close-btn" @click="closeWindow" :title="$t('nav_close')">
            <X :size="16" />
          </button>
        </div>
      </div>
    </div>

    <transition name="slide">
      <div v-if="showSettings" ref="settingsPanelRef" class="settings-panel">
        <div class="setting-item">
          <label>{{ $t('language') }}</label>
          <select :value="$i18n.locale" @change="changeLanguage">
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>

        <div class="setting-item">
          <label>{{ $t('nav_reset_shortcut') }}</label>
          <input
            type="text"
            :value="displayShortcut"
            @keydown.prevent="handleRecordShortcut"
            @focus="isRecording = true"
            @blur="isRecording = false"
            :placeholder="isRecording ? $t('nav_press_keys') : $t('nav_click_set')"
            class="shortcut-input"
            :class="{ recording: isRecording }"
            readonly
          />
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
// 【新增】引入 Square 图标
import { Settings, Minus, X, Square } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRefereeStore } from '../stores/refereeStore'

const { locale, t } = useI18n()
const store = useRefereeStore()
const showSettings = ref(false)

// Refs for click-outside detection
const settingsPanelRef = ref(null)
const settingsBtnRef = ref(null)

const isRecording = ref(false)

// 计算属性：显示当前快捷键或正在录制的状态
const displayShortcut = computed(() => {
  if (isRecording.value) return t('nav_press_keys')
  return store.appSettings.reset_shortcut || 'Ctrl+G'
})

// 切换设置面板
const toggleSettings = () => {
  showSettings.value = !showSettings.value
}

// 核心逻辑：点击外部关闭
const handleClickOutside = (event) => {
  if (showSettings.value) {
    const clickedInsidePanel = settingsPanelRef.value && settingsPanelRef.value.contains(event.target)
    const clickedBtn = settingsBtnRef.value && settingsBtnRef.value.contains(event.target)

    // 如果点击的既不是面板内部，也不是设置按钮本身，则关闭
    if (!clickedInsidePanel && !clickedBtn) {
      showSettings.value = false
      isRecording.value = false // 同时也取消录制状态
    }
  }
}

// 核心逻辑：录制快捷键
const handleRecordShortcut = (e) => {
  if (!isRecording.value) return

  // 忽略单独按下的修饰键 (Ctrl, Shift, Alt)
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

  const parts = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  // 将 e.key (如 'g') 转为大写 'G'
  let key = e.key.toUpperCase()
  // 处理特殊键名映射 (可选)
  if (key === ' ') key = 'Space'

  parts.push(key)

  const shortcutStr = parts.join('+')

  // 保存到 Store
  store.updateSetting('reset_shortcut', shortcutStr)

  // 结束录制并失焦
  isRecording.value = false
  e.target.blur()
}

// 挂载全局监听器
onMounted(() => {
  window.addEventListener('mousedown', handleClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('mousedown', handleClickOutside)
})

const changeLanguage = (event) => {
  const newLang = event.target.value
  locale.value = newLang
  localStorage.setItem('lang', newLang)
  store.updateSetting('language', newLang) // 同时也保存到后端配置
}

const minimizeWindow = () => {
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.send('window-min')
  }
}

// 【新增】最大化/还原函数
const maximizeWindow = () => {
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.send('window-max')
  }
}

const closeWindow = () => {
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.send('window-close')
  }
}
</script>

<style scoped lang="scss">
/* Style omitted - unchanged */
.navbar-container { position: relative; z-index: 1000; }
.navbar { display: flex; justify-content: space-between; align-items: center; height: 50px; background-color: #1e1e1e; padding-left: 20px; -webkit-app-region: drag; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2); user-select: none; }
.brand { display: flex; align-items: center; gap: 10px; color: #fff; font-weight: bold; font-size: 16px; }
.right-area { display: flex; align-items: center; height: 100%; -webkit-app-region: no-drag; }
.settings-btn { background: transparent; border: none; color: #ccc; cursor: pointer; padding: 8px; border-radius: 4px; margin-right: 15px; display: flex; align-items: center; transition: all 0.2s; &:hover, &.active { background-color: rgba(255, 255, 255, 0.1); color: white; } }
.window-controls { display: flex; height: 100%; }
.win-btn { background: transparent; border: none; color: #ccc; width: 46px; height: 100%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 0.2s, color 0.2s; outline: none; &:hover { background-color: rgba(255, 255, 255, 0.1); color: white; } &.close-btn:hover { background-color: #e81123; color: white; } }
.settings-panel { position: absolute; top: 50px; left: 0; right: 0; background-color: #252526; padding: 20px; border-bottom: 1px solid #333; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3); .setting-item { display: flex; align-items: center; margin-bottom: 15px; color: #ccc; label { width: 150px; font-size: 14px; } select, input { background: #3c3c3c; border: 1px solid #555; color: white; padding: 6px 10px; border-radius: 4px; flex: 1; max-width: 200px; outline: none; &:focus { border-color: #3498db; } } .shortcut-input { cursor: pointer; text-align: center; font-family: monospace; font-weight: bold; &.recording { border-color: #e67e22; color: #e67e22; background: rgba(230, 126, 34, 0.1); } } } }
.slide-enter-active, .slide-leave-active { transition: all 0.2s ease-out; }
.slide-enter-from, .slide-leave-to { transform: translateY(-10px); opacity: 0; }
</style>
