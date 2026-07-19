<template>
  <header class="title-bar" @dblclick="maximizeWindow">
    <div class="title-context">
      <strong>{{ pageTitle }}</strong>
      <span v-if="competitionContext">{{ competitionContext }}</span>
    </div>

    <div class="title-status">
      <span v-if="matchStore.matchActive" :class="['status-item', matchStore.matchStatus.worker]">
        <Cpu :size="14" />{{ $t(`match_worker_${matchStore.matchStatus.worker}`) }}
      </span>
      <span
        v-if="matchStore.matchActive"
        :class="['status-item', matchStore.matchStatus.persistence]"
      >
        <Database :size="14" />{{ $t(`match_persistence_${matchStore.matchStatus.persistence}`) }}
      </span>
    </div>

    <div class="window-controls">
      <button type="button" @click.stop="minimizeWindow" :title="$t('nav_minimize')">
        <Minus :size="15" />
      </button>
      <button type="button" @click.stop="maximizeWindow" :title="$t('nav_maximize')">
        <Square :size="13" />
      </button>
      <button type="button" class="close-button" @click.stop="closeWindow" :title="$t('nav_close')">
        <X :size="16" />
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { Cpu, Database, Minus, Square, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useCompetitionStore } from '../stores/competitionStore'
import { useMatchStore } from '../stores/matchStore'

const route = useRoute()
const { t } = useI18n()
const competitionStore = useCompetitionStore()
const matchStore = useMatchStore()

const routeLabels = {
  dashboard: 'nav_dashboard',
  competitions: 'nav_competitions',
  'competition-setup': 'competition_setup_title',
  scoring: 'scoring_title',
  replay: 'nav_replay',
  report: 'report_title',
  settings: 'nav_settings'
}

const pageTitle = computed(() => t(routeLabels[route.name] || 'app_title'))
const competitionContext = computed(() => {
  if (!competitionStore.projectConfig.id) return ''
  return [
    competitionStore.projectConfig.name,
    competitionStore.activeStage?.name,
    matchStore.currentContext.contestantName
  ]
    .filter(Boolean)
    .join(' / ')
})

const minimizeWindow = () => window.ftEngine?.window.minimize()
const maximizeWindow = () => window.ftEngine?.window.toggleMaximize()
const closeWindow = () => window.ftEngine?.window.close()
</script>

<style scoped>
.title-bar {
  height: 48px;
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  user-select: none;
  -webkit-app-region: drag;
}
.title-context {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 18px;
}
.title-context strong {
  flex: 0 0 auto;
  font-size: 0.8rem;
  font-weight: 700;
}
.title-context span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 0.7rem;
}
.title-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
}
.status-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-muted);
  font-size: 0.67rem;
  white-space: nowrap;
}
.status-item.ready,
.status-item.saved {
  color: var(--success);
}
.status-item.error {
  color: var(--danger);
}
.window-controls {
  align-self: stretch;
  display: flex;
  -webkit-app-region: no-drag;
}
.window-controls button {
  width: 44px;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.window-controls button:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.window-controls .close-button:hover {
  background: #c42b1c;
  color: white;
}
@media (max-width: 760px) {
  .title-status {
    display: none;
  }
}
</style>
