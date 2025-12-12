<template>
  <div class="home-view">
    <div class="hero-section">
      <h1>{{ $t('home_hero_title') }}</h1>
      <p>{{ $t('home_hero_subtitle') }}</p>
    </div>

    <div class="cards-grid">
      <div class="card new-match" @click="handleNewMatch">
        <div class="icon-circle">
          <Plus :size="32" />
        </div>
        <h3>{{ $t('btn_new_match') }}</h3>
      </div>

      <div class="card history" @click="openHistory">
        <div class="icon-circle">
          <History :size="32" />
        </div>
        <h3>{{ $t('btn_history') }}</h3>
      </div>
    </div>

    <div v-if="showHistoryModal" class="modal-overlay" @click.self="closeHistory">
      <div class="modal-content">
        <h3>{{ $t('lbl_history_list') }}</h3>

        <div class="project-list">
          <div v-for="p in projects" :key="p.dir_name" class="project-item">
            <div class="p-info">
              <div class="p-name">{{ p.project_name }}</div>
              <div class="p-date">{{ p.created_at }}</div>
            </div>
            <div class="p-actions">
              <button class="btn-small btn-view" @click="handleViewDetails(p)">{{ $t('home_btn_view') }}</button>
              <button class="btn-small btn-continue" @click="handleContinue(p)">{{ $t('home_btn_continue') }}</button>
              <button class="btn-small btn-delete" @click="handleDelete(p)" :title="$t('home_btn_delete')">
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
          <div v-if="projects.length === 0" class="no-data">{{ $t('home_no_history') }}</div>
        </div>

        <button class="btn-close" @click="closeHistory">{{ $t('home_btn_close') }}</button>
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
const props = defineProps({
  initialMode: {
    type: String,
    default: 'default'
  }
})

const emit = defineEmits(['navigate', 'view-report'])
const store = useRefereeStore()

const showHistoryModal = ref(false)
const projects = ref([])

onMounted(async () => {
  if (props.initialMode === 'history') {
    await openHistory()
  }
})

const handleNewMatch = () => {
  store.clearLocalConfig()
  emit('navigate', 'setup')
}

const openHistory = async () => {
  projects.value = await store.fetchHistoryProjects()
  showHistoryModal.value = true
}

const closeHistory = () => {
  showHistoryModal.value = false
}

const handleViewDetails = (project) => {
  emit('view-report', project.dir_name)
}

const handleContinue = async (project) => {
  const success = await store.loadProject(project.dir_name)
  if (success) {
    showHistoryModal.value = false
    emit('navigate', 'setup')
  }
}

const handleDelete = async (project) => {
  const confirmMsg = t('home_del_confirm', { name: project.project_name })
  if (confirm(confirmMsg)) {
    const success = await store.deleteProject(project.dir_name)
    if (success) {
      projects.value = await store.fetchHistoryProjects()
    } else {
      alert(t('home_del_fail'))
    }
  }
}
</script>

<style scoped lang="scss">
/* Style omitted - unchanged */
.home-view { padding: 40px; color: white; animation: fadeIn 0.5s; }
.hero-section { margin-bottom: 40px; h1 { font-size: 2.5rem; } p { color: #888; } }
.cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 30px; }
.card { background: #2b2b2b; border: 1px solid #3d3d3d; border-radius: 12px; padding: 30px; cursor: pointer; transition: 0.2s; display: flex; flex-direction: column; align-items: center; &:hover { background: #333; transform: translateY(-5px); } }
.icon-circle { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; }
.card.new-match .icon-circle { color: #2ecc71; background: rgba(46, 204, 113, 0.1); }
.card.history .icon-circle { color: #f39c12; background: rgba(243, 156, 18, 0.1); }
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 2000; }
.modal-content { background: #252526; width: 600px; max-height: 80vh; border-radius: 8px; padding: 20px; display: flex; flex-direction: column; }
.project-list { flex: 1; overflow-y: auto; margin: 15px 0; border: 1px solid #333; border-radius: 4px; }
.project-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #333; &:hover { background: #2d2d2d; } }
.p-info { .p-name { font-weight: bold; font-size: 1.1rem; } .p-date { color: #888; font-size: 0.85rem; } }
.p-actions { display: flex; gap: 8px; }
.btn-small { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; color: white; font-weight: bold; }
.btn-view { background: #3498db; &:hover { background: #2980b9; } }
.btn-continue { background: #2ecc71; &:hover { background: #27ae60; } }
.btn-delete { background: #c0392b; display: flex; align-items: center; justify-content: center; padding: 6px 10px; &:hover { background: #e74c3c; } }
.btn-close { align-self: flex-end; padding: 8px 20px; background: #555; color: white; border: none; cursor: pointer; border-radius: 4px; &:hover { background: #666; } }
.no-data { padding: 20px; text-align: center; color: #666; }
</style>
