<template>
  <div class="app-container">
    <NavBar />

    <div class="main-content">
      <HomeView
        v-if="currentView === 'home'"
        @navigate="handleNavigate"
      />

      <SetupWizard
        v-else-if="currentView === 'setup'"
        @cancel="currentView = 'home'"
        @finished="currentView = 'scoreboard'"
      />

      <ScoreBoard
        v-else-if="currentView === 'scoreboard'"
        @stop="currentView = 'home'"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import NavBar from './components/NavBar.vue'
import HomeView from './components/HomeView.vue'
import SetupWizard from './components/SetupWizard.vue'
import ScoreBoard from './components/ScoreBoard.vue'


const currentView = ref('home') // 默认显示主页

const handleNavigate = (view) => {
  currentView.value = view
}

// 修改 ScoreBoard.vue，增加 emit stop 事件
</script>

<style>
body { margin: 0; font-family: 'Segoe UI', sans-serif; background: #1e1e1e; overflow: hidden; }
.app-container { display: flex; flex-direction: column; height: 100vh; }
.main-content { flex: 1; overflow-y: auto; position: relative; }

/* 滚动条美化 */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: #2b2b2b; }
::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #777; }
</style>
