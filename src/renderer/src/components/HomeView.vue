<template>
  <div class="home-view">
    <div class="hero-section">
      <h1 class="gradient-text">{{ $t('home_hero_title') }}</h1>
      <p>{{ $t('home_hero_subtitle') }}</p>
    </div>

    <div class="cards-grid">
      <div class="card new-match" @click="handleNewMatch">
        <div class="card-bg"></div>
        <div class="icon-circle">
          <Plus :size="36" stroke-width="2" />
        </div>
        <div class="card-content">
          <h3>{{ $t('btn_new_match') }}</h3>
          <span class="card-desc">Start a fresh competition</span>
        </div>
      </div>

      <div class="card history" @click="openHistory">
        <div class="card-bg"></div>
        <div class="icon-circle">
          <History :size="36" stroke-width="2" />
        </div>
        <div class="card-content">
          <h3>{{ $t('btn_history') }}</h3>
          <span class="card-desc">View past records</span>
        </div>
      </div>
    </div>

    <div v-if="showHistoryModal" class="modal-overlay" @click.self="closeHistory">
      <div class="glass-modal">
        <div class="modal-header">
           <h3>{{ $t('lbl_history_list') }}</h3>
           <button class="btn-icon-close" @click="closeHistory">×</button>
        </div>

        <div class="project-list custom-scroll">
          <div v-for="p in projects" :key="p.dir_name" class="project-item">
            <div class="p-info">
              <div class="p-name">{{ p.project_name }}</div>
              <div class="p-date">{{ p.created_at }}</div>
            </div>
            <div class="p-actions">
              <button class="btn-mini btn-view" @click="handleViewDetails(p)">{{ $t('home_btn_view') }}</button>
              <button class="btn-mini btn-continue" @click="handleContinue(p)">{{ $t('home_btn_continue') }}</button>
              <button class="btn-mini btn-delete" @click="requestDelete(p)">
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
          <div v-if="projects.length === 0" class="no-data">{{ $t('home_no_history') }}</div>
        </div>
      </div>
    </div>

    <div v-if="showDeleteModal" class="modal-overlay" @click.self="cancelDelete">
      <div class="glass-modal delete-dialog">
        <h3 class="del-title">{{ $t('home_btn_delete') }}</h3>
        <p class="del-msg">
          {{ $t('home_del_confirm', { name: projectToDelete?.project_name }) }}
        </p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="cancelDelete">{{ $t('btn_cancel') }}</button>
          <button class="btn-confirm-delete" @click="confirmDelete">{{ $t('sb_btn_confirm') }}</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Plus, History, Trash2 } from 'lucide-vue-next'
import { useRefereeStore } from '../stores/refereeStore'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps({ initialMode: { type: String, default: 'default' } })
const emit = defineEmits(['navigate', 'view-report'])
const store = useRefereeStore()

const showHistoryModal = ref(false)
const projects = ref([])
const showDeleteModal = ref(false)
const projectToDelete = ref(null)

onMounted(async () => {
  if (props.initialMode === 'history') { await openHistory() }
})

const handleNewMatch = () => { store.clearLocalConfig(); emit('navigate', 'setup') }
const openHistory = async () => { projects.value = await store.fetchHistoryProjects(); showHistoryModal.value = true }
const closeHistory = () => { showHistoryModal.value = false }
const handleViewDetails = (project) => { emit('view-report', project.dir_name) }
const handleContinue = async (project) => {
  const success = await store.loadProject(project.dir_name)
  if (success) { showHistoryModal.value = false; emit('navigate', 'setup') }
}
const requestDelete = (project) => { projectToDelete.value = project; showDeleteModal.value = true }
const confirmDelete = async () => {
  if (!projectToDelete.value) return
  const success = await store.deleteProject(projectToDelete.value.dir_name)
  if (success) { projects.value = await store.fetchHistoryProjects(); showDeleteModal.value = false; projectToDelete.value = null }
  else { alert(t('home_del_fail')) }
}
const cancelDelete = () => { showDeleteModal.value = false; projectToDelete.value = null }
</script>

<style scoped lang="scss">
/* 布局容器 */
.home-view {
  width: 100%;
  max-width: 900px; /* 稍微限制最大宽度 */
  padding: 40px;
  margin: 0 auto; /* 【核心修复】确保内容在页面水平居中 */
  color: white;
  animation: slideUpFade 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
  text-align: center;
  box-sizing: border-box; /* 确保 padding 不会撑大宽度 */
}

/* 头部 */
.hero-section {
  margin-bottom: 50px; /* 稍微减小间距 */

  h1.gradient-text {
    font-size: 3rem; /* 稍微调小字体适配小窗口 */
    font-weight: 800;
    margin: 0 0 10px 0;
    background: linear-gradient(135deg, #fff 30%, #a5b4fc 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: -1px;
  }

  p {
    color: #9ca3af;
    font-size: 1.1rem;
    font-weight: 400;
  }
}

/* 卡片网格 */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 30px; /* 减小间距，防止过宽 */
  max-width: 720px; /* 【核心修复】减小最大宽度，避免贴边 */
  width: 100%;
  margin: 0 auto; /* 确保网格自身居中 */
}

/* 高级毛玻璃卡片 */
.card {
  position: relative;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  padding: 30px 20px; /* 调整内边距 */
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);

  &:hover {
    transform: translateY(-5px);
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.2);
    box-shadow: 0 20px 40px rgba(0,0,0,0.2);

    .icon-circle {
      transform: scale(1.1);
    }
  }
}

.card.new-match:hover .icon-circle { color: #4ade80; background: rgba(74, 222, 128, 0.15); box-shadow: 0 0 30px rgba(74, 222, 128, 0.3); }
.card.history:hover .icon-circle { color: #facc15; background: rgba(250, 204, 21, 0.15); box-shadow: 0 0 30px rgba(250, 204, 21, 0.3); }

/* 图标圆圈 */
.icon-circle {
  width: 70px; /* 稍微调小图标区域 */
  height: 70px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
  background: rgba(255, 255, 255, 0.05);
  color: #d1d5db;
  transition: all 0.4s ease;
}

/* 卡片文字 */
.card-content h3 { margin: 0; font-size: 1.25rem; color: #fff; }
.card-desc { font-size: 0.85rem; color: #6b7280; margin-top: 5px; display: block; }

/* 模态框等其他样式保持不变... */
.modal-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(5px);
  display: flex; justify-content: center; align-items: center;
  z-index: 2000;
  animation: fadeIn 0.2s;
}

.glass-modal {
  background: #18181b;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  width: 600px;
  max-height: 80vh;
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);

  &.delete-dialog { width: 400px; height: auto; text-align: center; }
}

.modal-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;
  h3 { margin: 0; font-size: 1.25rem; }
}

.btn-icon-close {
  background: transparent; border: none; color: #666; font-size: 24px; cursor: pointer;
  &:hover { color: #fff; }
}

.project-list {
  flex: 1; overflow-y: auto;
  border: 1px solid rgba(255,255,255,0.05);
  background: rgba(0,0,0,0.2);
  border-radius: 8px;
}
.project-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  transition: background 0.2s;
  &:hover { background: rgba(255,255,255,0.05); }
}

.p-name { font-weight: 600; font-size: 1rem; color: #e5e7eb; }
.p-date { color: #6b7280; font-size: 0.8rem; margin-top: 4px; }
.p-actions { display: flex; gap: 8px; }
.btn-mini {
  padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; color: white; font-weight: 500; font-size: 0.85rem; transition: opacity 0.2s;
  &:hover { opacity: 0.9; }
}
.btn-view { background: #3b82f6; }
.btn-continue { background: #10b981; }
.btn-delete { background: rgba(239, 68, 68, 0.2); color: #ef4444; &:hover { background: #ef4444; color: white; } }
.del-title { color: #ef4444; margin-top: 0; }
.del-msg { color: #d1d5db; margin: 20px 0; line-height: 1.5; }
.modal-actions { display: flex; justify-content: center; gap: 15px; margin-top: 10px; }
.btn-cancel { padding: 8px 20px; background: #374151; color: white; border: none; border-radius: 6px; cursor: pointer; }
.btn-confirm-delete { padding: 8px 20px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }

@keyframes slideUpFade {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
</style>
