<template>
  <section class="score-overlay-panel">
    <header v-if="showHeader" class="panel-header">
      <div class="panel-identity">
        <span class="panel-label">{{ $t('media_score_overlay') }}</span>
        <strong>{{ contestant || $t('ov_contestant_waiting') }}</strong>
      </div>
      <ScoreDisplayModeSwitch v-model="displayMode" />
    </header>

    <div v-if="refereeEntries.length" class="overlay-score-grid">
      <article v-for="[key, referee] in refereeEntries" :key="key" class="overlay-score-card">
        <div class="referee-header">
          <span>{{ referee.name || `${$t('lbl_referee')} ${key}` }}</span>
          <div v-if="referee.status" class="connection-status">
            <span :class="referee.status.pri || 'disconnected'"></span>
            <span
              v-if="referee.status.sec && referee.status.sec !== 'n/a'"
              :class="referee.status.sec"
            ></span>
          </div>
        </div>

        <RefereeScoreDisplay :referee="referee" :mode="displayMode" />
      </article>
    </div>
    <div v-else class="score-empty">{{ $t('media_score_empty') }}</div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import RefereeScoreDisplay from './RefereeScoreDisplay.vue'
import ScoreDisplayModeSwitch from './ScoreDisplayModeSwitch.vue'

const props = defineProps({
  referees: { type: Object, default: () => ({}) },
  contestant: { type: String, default: '' },
  showHeader: { type: Boolean, default: true },
  displayMode: { type: String, default: null }
})
const emit = defineEmits(['update:displayMode'])
const internalDisplayMode = ref('COMBINED')
const displayMode = computed({
  get: () => props.displayMode || internalDisplayMode.value,
  set: (value) => {
    if (props.displayMode) emit('update:displayMode', value)
    else internalDisplayMode.value = value
  }
})
const refereeEntries = computed(() => Object.entries(props.referees || {}))
</script>

<style scoped>
.score-overlay-panel { min-width: 0; color: var(--workbench-text); }
.panel-header { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.panel-identity { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.panel-label { color: var(--workbench-muted); font-size: 0.72rem; }
.panel-identity strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; }
.overlay-score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.overlay-score-card { min-width: 0; min-height: 94px; box-sizing: border-box; display: flex; flex-direction: column; padding: 10px 12px; border-left: 4px solid var(--workbench-accent); border-radius: 4px; background: color-mix(in srgb, var(--workbench-surface) 92%, transparent); box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.35); }
.referee-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 5px; border-bottom: 1px solid var(--workbench-border); color: var(--workbench-text-secondary); font-size: 0.76rem; }
.connection-status { display: inline-flex; gap: 4px; }
.connection-status span { width: 6px; height: 6px; border-radius: 50%; background: #666; }
.connection-status span.connected { background: #2ecc71; }
.connection-status span.connecting { background: #e0ad42; }
.score-empty { min-height: 110px; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--workbench-border); border-radius: 5px; color: var(--workbench-muted); font-size: 0.8rem; }
@media (max-width: 560px) {
  .panel-header { align-items: flex-start; flex-direction: column; }
  .overlay-score-grid { grid-template-columns: 1fr; }
}
</style>
