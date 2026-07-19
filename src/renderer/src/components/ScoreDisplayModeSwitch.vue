<template>
  <div class="score-display-mode-switch" :aria-label="$t('ov_lbl_mode')">
    <button
      v-for="option in modeOptions"
      :key="option.value"
      type="button"
      :class="{ active: modelValue === option.value }"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  modelValue: { type: String, default: 'COMBINED' },
  storageKey: { type: String, default: 'overlay_config_v2' }
})
const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()
const modeOptions = computed(() => [
  { value: 'TOTAL', label: t('ov_opt_total') },
  { value: 'SPLIT', label: t('ov_opt_split') },
  { value: 'COMBINED', label: t('ov_opt_combined') }
])

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(props.storageKey) || '{}')
    if (['TOTAL', 'SPLIT', 'COMBINED'].includes(saved.displayMode)) {
      emit('update:modelValue', saved.displayMode)
    }
  } catch {
    // Ignore invalid persisted display settings.
  }
})

watch(
  () => props.modelValue,
  (value) => {
    try {
      const saved = JSON.parse(localStorage.getItem(props.storageKey) || '{}')
      localStorage.setItem(props.storageKey, JSON.stringify({ ...saved, displayMode: value }))
    } catch {
      localStorage.setItem(props.storageKey, JSON.stringify({ displayMode: value }))
    }
  }
)
</script>

<style scoped>
.score-display-mode-switch {
  flex: 0 0 auto;
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--workbench-border);
  border-radius: 5px;
  background: color-mix(in srgb, var(--workbench-surface) 88%, transparent);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}
.score-display-mode-switch button {
  min-height: 30px;
  padding: 0 9px;
  border: 0;
  border-right: 1px solid var(--workbench-border);
  background: transparent;
  color: var(--workbench-muted-strong);
  font-size: 0.7rem;
  cursor: pointer;
}
.score-display-mode-switch button:last-child { border-right: 0; }
.score-display-mode-switch button:hover { background: var(--workbench-surface-hover); color: var(--workbench-text); }
.score-display-mode-switch button.active { background: var(--workbench-accent); color: #fff; }
</style>
