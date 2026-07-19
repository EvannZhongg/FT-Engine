<template>
  <div v-if="isOverlayWindow" class="overlay-root">
    <OverlayView />
  </div>
  <AppShell v-else />
</template>

<script setup>
import { computed, onMounted, onUnmounted, watch } from 'vue'
import AppShell from './app/layouts/AppShell.vue'
import OverlayView from './components/OverlayView.vue'
import { useMatchStore } from './stores/matchStore'
import { useSettingsStore } from './stores/settingsStore'

const matchStore = useMatchStore()
const settingsStore = useSettingsStore()
const isOverlayWindow = computed(
  () => new URLSearchParams(window.location.search).get('mode') === 'overlay'
)

watch(
  () => settingsStore.appSettings.theme,
  (theme) => {
    document.documentElement.dataset.theme = theme || 'light'
  },
  { immediate: true }
)

onMounted(async () => {
  document.title = isOverlayWindow.value ? 'FT Engine Overlay' : 'FT Engine'
  if (isOverlayWindow.value) return
  await Promise.all([matchStore.connectMatchEvents(), settingsStore.fetchSettings()])
  window.ftEngine?.window.setContentProtection(Boolean(settingsStore.appSettings.obs_protect_main))
})

onUnmounted(() => {
  if (!isOverlayWindow.value) matchStore.disconnectMatchEvents()
})
</script>

<style>
.overlay-root {
  width: 100%;
  height: 100%;
  background: transparent;
}
</style>
