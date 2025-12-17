<template>
  <div v-if="isOverlayWindow" class="app-container transparent-bg">
    <OverlayView />
  </div>

  <div v-else class="app-container">
    <NavBar />

    <div class="main-content">
      <HomeView
        v-if="currentView === 'home'"
        :initialMode="homeInitialMode"
        @navigate="handleNavigate"
        @view-report="handleViewReport"
      />

      <SetupWizard
        v-else-if="currentView === 'setup'"
        @cancel="returnToHome('default')"
        @finished="currentView = 'scoreboard'"
      />

      <ScoreBoard
        v-else-if="currentView === 'scoreboard'"
        @stop="handleStopMatch"
      />

      <ReportView
        v-else-if="currentView === 'report'"
        :projectDir="targetProjectDir"
        @back="returnToHome('history')"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import NavBar from './components/NavBar.vue'
import HomeView from './components/HomeView.vue'
import SetupWizard from './components/SetupWizard.vue'
import ScoreBoard from './components/ScoreBoard.vue'
import OverlayView from './components/OverlayView.vue'
import ReportView from './components/ReportView.vue'
import { useRefereeStore } from './stores/refereeStore'

const currentView = ref('home')
const targetProjectDir = ref(null) // 用于传递给 ReportView
const homeInitialMode = ref('default') // 新增：控制 HomeView 初始显示状态 (default | history)
const store = useRefereeStore()

const isOverlayWindow = computed(() => {
  return new URLSearchParams(window.location.search).get('mode') === 'overlay'
})

onMounted(() => {
  // 1. 建立 WebSocket 连接 (原有逻辑)
  store.connectWebSocket()

  // 2. 自动更新监听逻辑 (新增)
  // 仅在 Electron 环境下运行
  if (window.electron && window.electron.ipcRenderer) {
    const ipc = window.electron.ipcRenderer

    // 监听：发现新版本
    ipc.on('update_available', () => {
      console.log('Update available: Downloading in background...')
      // 这里可以选择不打扰用户，让其静默下载
      // 如果想要提示，可以取消注释下面这行：
      // alert('发现新版本，正在后台下载...')
    })

    // 监听：下载完成
    ipc.on('update_downloaded', () => {
      // 延时一点点执行，避免界面刚加载完成就弹窗
      setTimeout(() => {
        const userChoice = confirm('新版本已下载完毕，是否立即重启并安装更新？')
        if (userChoice) {
          // 发送重启命令给主进程
          ipc.send('restart_app')
        }
      }, 1000)
    })
  }
})

const handleNavigate = (view) => {
  currentView.value = view
}

// 处理查看报表的跳转
const handleViewReport = (dirName) => {
  targetProjectDir.value = dirName
  currentView.value = 'report'
}

const handleStopMatch = async () => {
  await store.stopMatch()
  // 停止比赛后返回默认首页
  returnToHome('default')
}

// 统一的返回首页逻辑
const returnToHome = (mode = 'default') => {
  homeInitialMode.value = mode
  currentView.value = 'home'
}
</script>

<style>
/* 全局重置 */
body { margin: 0; overflow: hidden; }

/* 默认应用背景：深灰 */
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #1e1e1e; /* 这里定义默认背景 */
  transition: background-color 0.3s;
}

/* 【关键】悬浮模式下的透明背景 */
.transparent-bg {
  background-color: transparent !important;
}
.main-content { flex: 1; position: relative; overflow: hidden; }
</style>
