<template>
  <div class="competition-table-wrap">
    <table class="competition-table">
      <thead>
        <tr>
          <th>{{ $t('competition_name') }}</th>
          <th>{{ $t('competition_mode') }}</th>
          <th>{{ $t('competition_created') }}</th>
          <th class="actions-heading">{{ $t('competition_actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="project in visibleProjects" :key="project.id">
          <td>
            <strong>{{ project.name }}</strong>
          </td>
          <td>
            <span class="mode-label">{{ project.mode || 'FREE' }}</span>
          </td>
          <td class="muted-cell">{{ formatDate(project.createdAt) }}</td>
          <td class="row-actions">
            <button
              class="continue-button"
              type="button"
              :disabled="busyId === project.id"
              @click="continueCompetition(project)"
            >
              <Play :size="14" fill="currentColor" />
              {{ $t('home_btn_continue') }}
            </button>
            <button
              class="icon-button"
              type="button"
              :title="$t('home_btn_view')"
              @click="openReport(project)"
            >
              <BarChart3 :size="17" />
            </button>
            <button
              class="icon-button"
              type="button"
              :title="$t('nav_replay')"
              @click="openReplay(project)"
            >
              <Clapperboard :size="17" />
            </button>
            <div class="more-wrap">
              <button
                class="icon-button"
                type="button"
                :title="$t('competition_more')"
                @click="toggleMenu(project.id)"
              >
                <MoreHorizontal :size="18" />
              </button>
              <div v-if="menuProjectId === project.id" class="row-menu">
                <button type="button" @click="requestDelete(project)">
                  <Trash2 :size="15" />{{ $t('home_btn_delete') }}
                </button>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="competitionStore.listStatus === 'loading'" class="table-empty">
      {{ $t('competition_loading') }}
    </div>
    <div v-else-if="visibleProjects.length === 0" class="table-empty">
      {{ $t('home_no_history') }}
    </div>
    <p v-if="errorMessage" class="inline-error" role="status">{{ errorMessage }}</p>
  </div>

  <AppDialog
    :open="Boolean(projectToDelete)"
    :title="$t('home_btn_delete')"
    :message="$t('home_del_confirm', { name: projectToDelete?.name })"
    :confirm-text="$t('home_btn_delete')"
    :cancel-text="$t('btn_cancel')"
    :busy="busyId === projectToDelete?.id"
    danger
    @confirm="confirmDelete"
    @cancel="projectToDelete = null"
  />
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { BarChart3, Clapperboard, MoreHorizontal, Play, Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppDialog from '../../components/AppDialog.vue'
import { useCompetitionStore } from '../../stores/competitionStore'
import { useMatchStore } from '../../stores/matchStore'

const props = defineProps({ limit: { type: Number, default: 0 } })
const competitionStore = useCompetitionStore()
const matchStore = useMatchStore()
const router = useRouter()
const { t, locale } = useI18n()
const busyId = ref('')
const menuProjectId = ref('')
const projectToDelete = ref(null)
const errorMessage = ref('')

const visibleProjects = computed(() =>
  props.limit > 0 ? competitionStore.projects.slice(0, props.limit) : competitionStore.projects
)

onMounted(() => competitionStore.fetchHistoryProjects())

const formatDate = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(date)
}

const toggleMenu = (competitionId) => {
  menuProjectId.value = menuProjectId.value === competitionId ? '' : competitionId
}

const continueCompetition = async (project) => {
  busyId.value = project.id
  errorMessage.value = ''
  const loaded = await competitionStore.loadProject(project.id)
  busyId.value = ''
  if (!loaded) {
    errorMessage.value = t('competition_open_failed')
    return
  }
  matchStore.clearLocalState()
  await router.push({ path: '/competitions/setup', query: { competition: project.id } })
}

const openReport = (project) => router.push(`/competitions/${project.id}/report`)
const openReplay = (project) => router.push({ path: '/replay', query: { competition: project.id } })
const requestDelete = (project) => {
  menuProjectId.value = ''
  projectToDelete.value = project
}

const confirmDelete = async () => {
  if (!projectToDelete.value) return
  busyId.value = projectToDelete.value.id
  errorMessage.value = ''
  const deleted = await competitionStore.deleteProject(projectToDelete.value.id)
  busyId.value = ''
  if (!deleted) errorMessage.value = t('home_del_fail')
  else projectToDelete.value = null
}
</script>

<style scoped>
.competition-table-wrap {
  position: relative;
  width: 100%;
  overflow: visible;
}
.competition-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.competition-table th {
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.7rem;
  font-weight: 700;
  text-align: left;
  text-transform: uppercase;
}
.competition-table td {
  height: 54px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-size: 0.8rem;
}
.competition-table tbody tr:hover {
  background: var(--surface-hover);
}
.competition-table th:nth-child(1) {
  width: 34%;
}
.competition-table th:nth-child(2) {
  width: 14%;
}
.competition-table th:nth-child(3) {
  width: 20%;
}
.competition-table th:nth-child(4) {
  width: 32%;
}
.muted-cell {
  color: var(--text-secondary) !important;
}
.mode-label {
  display: inline-block;
  color: var(--text-secondary);
  font-size: 0.7rem;
  font-weight: 700;
}
.actions-heading {
  text-align: right !important;
}
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.continue-button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  background: var(--accent);
  color: white;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 700;
}
.continue-button:disabled {
  opacity: 0.55;
  cursor: wait;
}
.icon-button {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.icon-button:hover {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text-primary);
}
.more-wrap {
  position: relative;
}
.row-menu {
  position: absolute;
  top: 34px;
  right: 0;
  z-index: 20;
  width: 150px;
  padding: 5px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  box-shadow: var(--shadow-menu);
}
.row-menu button {
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--danger);
  cursor: pointer;
  font-size: 0.77rem;
}
.row-menu button:hover {
  background: var(--danger-soft);
}
.table-empty {
  min-height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 0.82rem;
}
.inline-error {
  margin: 10px 12px 0;
  color: var(--danger);
  font-size: 0.78rem;
}
@media (max-width: 860px) {
  .competition-table th:nth-child(2),
  .competition-table td:nth-child(2) {
    display: none;
  }
  .competition-table th:nth-child(1) {
    width: 32%;
  }
  .competition-table th:nth-child(3) {
    width: 24%;
  }
  .competition-table th:nth-child(4) {
    width: 44%;
  }
}
</style>
