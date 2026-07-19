<template>
  <div class="page-container dashboard-page">
    <header class="page-header">
      <div>
        <h1>{{ $t('nav_dashboard') }}</h1>
        <p>{{ $t('dashboard_subtitle') }}</p>
      </div>
      <button class="button-primary" type="button" @click="createCompetition">
        <Plus :size="16" />
        {{ $t('btn_new_match') }}
      </button>
    </header>

    <section v-if="matchStore.matchActive" class="active-match-band">
      <div class="active-marker"><Radio :size="17" /></div>
      <div class="active-copy">
        <strong>{{ competitionStore.projectConfig.name || $t('dashboard_active_match') }}</strong>
        <span>{{ activeContext }}</span>
      </div>
      <button class="button-primary" type="button" @click="router.push('/scoring')">
        <Play :size="15" fill="currentColor" />
        {{ $t('dashboard_continue_scoring') }}
      </button>
    </section>

    <section v-if="healthItems.length" class="health-strip" aria-live="polite">
      <div v-for="item in healthItems" :key="item.label" :class="['health-chip', item.tone]">
        <component :is="item.icon" :size="15" />
        <span>{{ item.label }}</span>
      </div>
    </section>

    <section class="page-section">
      <div class="section-heading">
        <div>
          <h2>{{ $t('dashboard_recent') }}</h2>
          <p>{{ $t('dashboard_recent_hint') }}</p>
        </div>
        <RouterLink to="/competitions"
          >{{ $t('dashboard_view_all') }} <ArrowRight :size="14"
        /></RouterLink>
      </div>
      <CompetitionTable :limit="6" />
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ArrowRight, CircleAlert, Database, Play, Plus, Radio, Usb } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import CompetitionTable from '../competitions/CompetitionTable.vue'
import { useCompetitionStore } from '../../stores/competitionStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { useMatchStore } from '../../stores/matchStore'
import { useSettingsStore } from '../../stores/settingsStore'

const competitionStore = useCompetitionStore()
const deviceStore = useDeviceStore()
const matchStore = useMatchStore()
const settingsStore = useSettingsStore()
const router = useRouter()
const { t } = useI18n()

const activeContext = computed(() =>
  [
    competitionStore.activeStage?.name,
    matchStore.currentContext.groupName,
    matchStore.currentContext.contestantName
  ]
    .filter(Boolean)
    .join(' / ')
)

const healthItems = computed(() => {
  const items = []
  if (matchStore.matchStatus.persistence === 'error') {
    items.push({ label: t('dashboard_storage_error'), icon: Database, tone: 'error' })
  }
  if (matchStore.matchStatus.worker === 'error' || deviceStore.workerStatus === 'error') {
    items.push({ label: t('dashboard_device_error'), icon: Usb, tone: 'error' })
  }
  if (settingsStore.errorCode) {
    items.push({ label: t('dashboard_settings_error'), icon: CircleAlert, tone: 'warning' })
  }
  return items
})

const createCompetition = () => {
  competitionStore.clearLocalConfig()
  matchStore.clearLocalState()
  router.push('/competitions/setup')
}
</script>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.active-match-band {
  min-height: 70px;
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 12px 16px;
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
}
.active-marker {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent);
  color: white;
}
.active-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.active-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.86rem;
}
.active-copy span {
  color: var(--text-secondary);
  font-size: 0.74rem;
}
.health-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.health-chip {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--warning-border);
  border-radius: 5px;
  background: var(--warning-soft);
  color: var(--warning-text);
  font-size: 0.75rem;
}
.health-chip.error {
  border-color: var(--danger-border);
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
