<template>
  <div class="navbar-container">
    <div class="navbar">
      <div class="brand">
        <span class="logo-icon">🏆</span>
        <span class="title">{{ $t('app_title') }}</span>
      </div>

      <div class="right-area">
        <button class="btn-icon settings-btn" @click="toggleSettings" title="Settings">
          <Settings :size="18" />
        </button>

        <div class="window-controls">
          <button class="win-btn" @click="minimizeWindow" title="Minimize">
            <Minus :size="16" />
          </button>
          <button class="win-btn close-btn" @click="closeWindow" title="Close">
            <X :size="16" />
          </button>
        </div>
      </div>
    </div>

    <transition name="slide">
      <div v-if="showSettings" class="settings-panel">
        <div class="setting-item">
          <label>{{ $t('language') }}</label>
          <select :value="$i18n.locale" @change="changeLanguage">
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>

        <div class="setting-item">
          <label>Reset Shortcut</label>
          <input type="text" value="Ctrl+G" readonly disabled />
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Settings, Minus, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { locale } = useI18n()
const showSettings = ref(false)

// 切换设置面板显示
const toggleSettings = () => {
  showSettings.value = !showSettings.value
}

// 切换语言
const changeLanguage = (event) => {
  const newLang = event.target.value
  locale.value = newLang
  localStorage.setItem('lang', newLang) // 本地存储用户选择
}

// 最小化窗口
const minimizeWindow = () => {
  // 确保你的 preload/index.js 中暴露了 electron API (electron-vite 默认模板已包含)
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.send('window-min')
  } else {
    console.warn('Electron IPC not available')
  }
}

// 关闭窗口
const closeWindow = () => {
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.send('window-close')
  } else {
    console.warn('Electron IPC not available')
  }
}
</script>

<style scoped lang="scss">
.navbar-container {
  position: relative;
  z-index: 1000; /* 确保在最上层 */
}

.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 50px;
  background-color: #1e1e1e;
  padding-left: 20px;
  /* 关键：整条栏允许拖拽窗口 */
  -webkit-app-region: drag;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  user-select: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-weight: bold;
  font-size: 16px;
  /* Logo区域也可以拖拽，无需特殊处理 */
}

.right-area {
  display: flex;
  align-items: center;
  height: 100%;
  /* 关键：按钮区域必须设为不可拖拽，否则无法点击 */
  -webkit-app-region: no-drag;
}

/* 设置按钮样式 */
.settings-btn {
  background: transparent;
  border: none;
  color: #ccc;
  cursor: pointer;
  padding: 8px;
  border-radius: 4px;
  margin-right: 15px;
  display: flex;
  align-items: center;
  transition: all 0.2s;

  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: white;
  }
}

/* 窗口控制按钮容器 */
.window-controls {
  display: flex;
  height: 100%;
}

/* 最小化/关闭按钮通用样式 */
.win-btn {
  background: transparent;
  border: none;
  color: #ccc;
  width: 46px; /* 足够宽的点击区域 */
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
  outline: none;

  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: white;
  }

  /* 关闭按钮的特殊悬停样式（红色） */
  &.close-btn:hover {
    background-color: #e81123;
    color: white;
  }
}

/* 设置面板样式 */
.settings-panel {
  position: absolute;
  top: 50px; /* 紧贴导航栏下方 */
  left: 0;
  right: 0;
  background-color: #252526;
  padding: 20px;
  border-bottom: 1px solid #333;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);

  .setting-item {
    display: flex;
    align-items: center;
    margin-bottom: 15px;
    color: #ccc;

    label {
      width: 150px;
      font-size: 14px;
    }

    select,
    input {
      background: #3c3c3c;
      border: 1px solid #555;
      color: white;
      padding: 6px 10px;
      border-radius: 4px;
      flex: 1;
      max-width: 200px;
      outline: none;

      &:focus {
        border-color: #3498db;
      }
    }

    input[disabled] {
      color: #777;
      cursor: not-allowed;
    }
  }
}

/* Vue Transition 动画 */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease-out;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}
</style>
