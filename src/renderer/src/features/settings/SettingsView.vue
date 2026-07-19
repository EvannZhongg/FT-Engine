<template>
  <div class="page-container settings-page">
    <header class="page-header">
      <div>
        <h1>{{ $t('nav_settings') }}</h1>
        <p>{{ $t('settings_subtitle') }}</p>
      </div>
      <span v-if="saveState" :class="['save-indicator', saveState]">{{
        $t(`settings_${saveState}`)
      }}</span>
    </header>

    <section class="settings-group">
      <div class="settings-group-heading">
        <h2>{{ $t('settings_appearance') }}</h2>
        <p>{{ $t('settings_appearance_hint') }}</p>
      </div>
      <div class="settings-rows">
        <label class="settings-row">
          <span
            ><strong>{{ $t('language') }}</strong
            ><small>{{ $t('settings_language_hint') }}</small></span
          >
          <select :value="locale" @change="changeLanguage">
            <option value="zh">简体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </label>
        <div class="settings-row">
          <span
            ><strong>{{ $t('settings_theme') }}</strong
            ><small>{{ $t('settings_theme_hint') }}</small></span
          >
          <div class="segmented-control" role="group" :aria-label="$t('settings_theme')">
            <button
              v-for="theme in themes"
              :key="theme"
              type="button"
              :class="{ active: currentTheme === theme }"
              @click="setTheme(theme)"
            >
              {{ $t(`settings_theme_${theme}`) }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-group">
      <div class="settings-group-heading">
        <h2>{{ $t('settings_controls') }}</h2>
        <p>{{ $t('settings_controls_hint') }}</p>
      </div>
      <div class="settings-rows">
        <label class="settings-row">
          <span
            ><strong>{{ $t('nav_reset_shortcut') }}</strong
            ><small>{{ $t('settings_shortcut_hint') }}</small></span
          >
          <input
            class="shortcut-input"
            type="text"
            :value="displayShortcut"
            readonly
            @focus="isRecording = true"
            @blur="isRecording = false"
            @keydown.prevent="recordShortcut"
          />
        </label>
        <div class="settings-row">
          <span
            ><strong>{{ $t('nav_obs_protect') }}</strong
            ><small>{{ $t('nav_obs_protect_hint') }}</small></span
          >
          <button
            class="switch-control"
            type="button"
            role="switch"
            :aria-checked="obsProtection"
            :class="{ active: obsProtection }"
            @click="setObsProtection(!obsProtection)"
          >
            <span />
          </button>
        </div>
      </div>
    </section>

    <section class="settings-group danger-group">
      <div class="settings-group-heading">
        <h2>{{ $t('settings_storage') }}</h2>
        <p>{{ $t('settings_storage_hint') }}</p>
      </div>
      <div class="settings-rows">
        <div class="settings-row">
          <span
            ><strong>{{ $t('nav_delete_local_data') }}</strong
            ><small>{{ $t('settings_delete_hint') }}</small></span
          >
          <button class="button-danger-outline" type="button" @click="showDeleteDialog = true">
            <Trash2 :size="15" />{{ $t('nav_delete_local_data_action') }}
          </button>
        </div>
        <p v-if="deleteError" class="settings-error" role="status">
          {{ $t('nav_delete_local_data_fail') }}
        </p>
      </div>
    </section>

    <AppDialog
      :open="showDeleteDialog"
      :title="$t('nav_delete_local_data')"
      :message="$t('nav_delete_local_data_confirm')"
      :confirm-text="$t('nav_delete_local_data_action')"
      :cancel-text="$t('btn_cancel')"
      :busy="isDeletingData"
      danger
      @confirm="deleteLocalData"
      @cancel="showDeleteDialog = false"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import AppDialog from '../../components/AppDialog.vue'
import { useSettingsStore } from '../../stores/settingsStore'

const settingsStore = useSettingsStore()
const { locale, t } = useI18n()
const themes = ['light', 'dark']
const isRecording = ref(false)
const saveState = ref('')
const showDeleteDialog = ref(false)
const isDeletingData = ref(false)
const deleteError = ref(false)
let clearSaveStateTimer = null

const currentTheme = computed(() => settingsStore.appSettings.theme || 'light')
const obsProtection = computed(() => Boolean(settingsStore.appSettings.obs_protect_main))
const displayShortcut = computed(() =>
  isRecording.value ? t('nav_press_keys') : settingsStore.appSettings.reset_shortcut || 'Ctrl+G'
)

onMounted(() => settingsStore.fetchSettings())

watch(
  currentTheme,
  (theme) => {
    document.documentElement.dataset.theme = theme
  },
  { immediate: true }
)

const persist = async (key, value) => {
  saveState.value = 'saving'
  const saved = await settingsStore.updateSetting(key, value)
  saveState.value = saved ? 'saved' : 'error'
  clearTimeout(clearSaveStateTimer)
  clearSaveStateTimer = setTimeout(() => {
    saveState.value = ''
  }, 2400)
  return saved
}

const changeLanguage = async (event) => {
  const language = event.target.value
  locale.value = language
  localStorage.setItem('lang', language)
  await persist('language', language)
}
const setTheme = (theme) => persist('theme', theme)
const setObsProtection = async (enabled) => {
  if (await persist('obs_protect_main', enabled))
    window.ftEngine?.window.setContentProtection(enabled)
}

const recordShortcut = (event) => {
  if (!isRecording.value || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
  const parts = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push('Command')
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  parts.push(event.key === ' ' ? 'Space' : event.key.toUpperCase())
  void persist('reset_shortcut', parts.join('+'))
  isRecording.value = false
  event.target.blur()
}

const deleteLocalData = async () => {
  if (isDeletingData.value || !window.ftEngine?.app) return
  isDeletingData.value = true
  deleteError.value = false
  try {
    const result = await window.ftEngine.app.deleteLocalData()
    if (!result?.ok) {
      console.error('Delete local data failed:', result?.failed)
      deleteError.value = true
      showDeleteDialog.value = false
    }
  } catch (error) {
    console.error('Delete local data failed:', error)
    deleteError.value = true
    showDeleteDialog.value = false
  } finally {
    isDeletingData.value = false
  }
}
</script>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.settings-group {
  display: grid;
  grid-template-columns: minmax(190px, 0.32fr) minmax(0, 0.68fr);
  gap: 34px;
  padding: 22px 0;
  border-top: 1px solid var(--border);
}
.settings-group-heading h2 {
  margin: 0 0 5px;
  font-size: 0.9rem;
  font-weight: 700;
}
.settings-group-heading p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1.5;
}
.settings-rows {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
}
.settings-row {
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
}
.settings-row:last-child {
  border-bottom: 0;
}
.settings-row > span {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.settings-row strong {
  font-size: 0.8rem;
  font-weight: 650;
}
.settings-row small {
  color: var(--text-muted);
  font-size: 0.7rem;
  line-height: 1.45;
}
.settings-row select,
.shortcut-input {
  width: 190px;
  height: 34px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--text-primary);
  padding: 0 9px;
}
.shortcut-input {
  text-align: center;
  font-family: ui-monospace, monospace;
  cursor: pointer;
}
.segmented-control {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  overflow: hidden;
}
.segmented-control button {
  min-width: 76px;
  height: 32px;
  border: 0;
  border-right: 1px solid var(--border-strong);
  background: var(--input-bg);
  color: var(--text-secondary);
  cursor: pointer;
}
.segmented-control button:last-child {
  border-right: 0;
}
.segmented-control button.active {
  background: var(--accent);
  color: white;
}
.switch-control {
  width: 42px;
  height: 24px;
  flex: 0 0 42px;
  padding: 2px;
  border: 0;
  border-radius: 12px;
  background: var(--border-strong);
  cursor: pointer;
}
.switch-control span {
  width: 20px;
  height: 20px;
  display: block;
  border-radius: 50%;
  background: white;
  transition: transform 0.15s ease;
}
.switch-control.active {
  background: var(--accent);
}
.switch-control.active span {
  transform: translateX(18px);
}
.danger-group {
  margin-bottom: 30px;
}
.settings-error {
  margin: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--danger-border);
  color: var(--danger);
  font-size: 0.75rem;
}
.save-indicator {
  color: var(--text-muted);
  font-size: 0.75rem;
}
.save-indicator.saved {
  color: var(--success);
}
.save-indicator.error {
  color: var(--danger);
}
@media (max-width: 900px) {
  .settings-group {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
</style>
