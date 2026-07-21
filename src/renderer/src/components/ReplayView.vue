<template>
  <div class="replay-view">
    <header class="replay-header">
      <button class="back-button" :title="$t('replay_back')" @click="router.push('/dashboard')">
        <ArrowLeft :size="18" />
      </button>
      <div>
        <h2>{{ $t('replay_title') }}</h2>
        <div class="replay-subtitle">{{ selectedProjectName }}</div>
      </div>
      <ScoreDisplayModeSwitch v-model="replayDisplayMode" />
    </header>

    <div class="replay-layout">
      <main class="replay-main">
        <section class="replay-media">
          <MediaPlayer
            v-if="selectedProjectDir"
            ref="playerRef"
            :binding="currentReplayBinding"
            :playback-session-id="replayPlaybackSessionId"
            :empty-text="$t('media_empty')"
            :open-text="$t('media_open_browser')"
            @snapshot="handlePlayback"
          />
          <div v-else class="empty-replay">
            <FolderOpen :size="34" />
            <strong>{{ $t('replay_choose_project') }}</strong>
            <span>{{ $t('replay_choose_project_hint') }}</span>
            <button type="button" @click="sidebarOpen = true">
              {{ $t('replay_choose_project_action') }}
            </button>
          </div>
          <ScoreOverlayPanel
            v-if="currentReplayBinding"
            class="replay-score-overlay"
            :referees="visibleReplayScores"
            :contestant="selectedContestant"
            :display-mode="replayDisplayMode"
            :show-header="false"
            draggable
            position-key="replay-score-overlay-position"
          />
        </section>
      </main>

      <aside
        class="replay-sidebar"
        :class="{ open: sidebarOpen }"
        @mouseenter="sidebarOpen = true"
        @mouseleave="sidebarOpen = false"
        @focusin="sidebarOpen = true"
      >
        <div
          class="replay-sidebar-rail"
          role="button"
          tabindex="0"
          :aria-label="$t('replay_open_panel')"
          :aria-expanded="sidebarOpen"
          aria-controls="replay-controls"
          @keydown.enter="sidebarOpen = true"
          @keydown.space.prevent="sidebarOpen = true"
        ></div>

        <div
          id="replay-controls"
          class="replay-sidebar-content"
          :inert="!sidebarOpen"
          :aria-hidden="!sidebarOpen"
        >
          <div class="replay-sidebar-title">{{ $t('replay_panel_title') }}</div>
          <div class="replay-filters">
            <label>
              <span>{{ $t('replay_project') }}</span>
              <select v-model="selectedProjectDir" @change="handleProjectSelected">
                <option value="" disabled>{{ $t('replay_select_project') }}</option>
                <option v-for="project in projects" :key="project.id" :value="project.id">
                  {{ project.name }}
                </option>
              </select>
            </label>
            <label>
              <span>{{ $t('replay_group') }}</span>
              <select v-model="selectedGroup" :disabled="!selectedProjectDir">
                <option v-for="group in availableGroups" :key="group.name" :value="group.name">
                  {{ group.name }}
                </option>
              </select>
            </label>
            <label>
              <span>{{ $t('replay_contestant') }}</span>
              <select v-model="selectedContestant" :disabled="!selectedGroup">
                <option
                  v-for="contestant in availableContestants"
                  :key="contestant"
                  :value="contestant"
                >
                  {{ contestant }}
                </option>
              </select>
            </label>
            <label v-if="bindingVersions.length > 0">
              <span>{{ $t('replay_media_version') }}</span>
              <select v-model="selectedBindingVersionId">
                <option v-if="binding" :value="binding.version_id">
                  {{ $t('replay_current_version') }} · r{{ binding.revision }}
                </option>
                <option v-for="version in bindingVersions" :key="version.id" :value="version.id">
                  r{{ version.revision }} · {{ version.provider }} / {{ version.media_id
                  }}{{ version.segment ? ` · ${version.segment}` : '' }}
                </option>
              </select>
            </label>
            <label>
              <span>{{ $t('replay_referee') }}</span>
              <select v-model="selectedReferee" :disabled="events.length === 0">
                <option value="all">{{ $t('replay_all_referees') }}</option>
                <option
                  v-for="referee in referees"
                  :key="referee.index"
                  :value="String(referee.index)"
                >
                  {{ referee.name }}
                </option>
              </select>
            </label>
          </div>

          <section v-if="selectedProjectDir" class="timeline">
            <div class="timeline-header">
              <h3>{{ $t('replay_events') }}</h3>
              <span>{{ filteredEvents.length }}</span>
            </div>
            <div v-if="loading" class="timeline-empty">{{ $t('replay_loading') }}</div>
            <div v-else-if="filteredEvents.length === 0" class="timeline-empty">
              {{ $t('replay_no_events') }}
            </div>
            <div v-else class="event-list">
              <button
                v-for="event in filteredEvents"
                :key="event.event_id"
                class="event-row"
                :class="{ active: event.event_id === activeEventId, unaligned: !isAligned(event) }"
                :disabled="!isAligned(event)"
                @click="jumpToEvent(event)"
              >
                <span class="video-time">{{ formatMediaTime(event.media_time_ms) }}</span>
                <span class="event-system-time">{{ formatSystemTime(event.system_time) }}</span>
                <span class="event-ref">
                  {{ event.referee_name }} · {{ roleLabel(event.device_role) }}
                </span>
                <span class="event-delta">{{ formatDelta(event) }}</span>
                <span class="event-total">{{ $t('replay_total') }} {{ event.current_total }}</span>
                <span v-if="!isAligned(event)" class="sync-status">
                  {{ syncStatusLabel(event.media_sync_status) }}
                </span>
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowLeft, FolderOpen } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { buildReplayScores } from '../media/replayScores.mjs'
import { useCompetitionStore } from '../stores/competitionStore'
import { useReplayStore } from '../stores/replayStore'
import ScoreOverlayPanel from './ScoreOverlayPanel.vue'
import ScoreDisplayModeSwitch from './ScoreDisplayModeSwitch.vue'
import MediaPlayer from './MediaPlayer.vue'

const competitionStore = useCompetitionStore()
const replayStore = useReplayStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projects = ref([])
const selectedProjectDir = ref('')
const selectedGroup = ref('')
const selectedContestant = ref('')
const selectedReferee = ref('all')
const binding = ref(null)
const bindingVersions = ref([])
const events = ref([])
const selectedBindingVersionId = ref('')
const replayPlaybackSessionId = ref('replay-initial')
const playbackTimeMs = ref(0)
const activeEventId = ref('')
const loading = ref(false)
const playerRef = ref(null)
const replayDisplayMode = ref('COMBINED')
const sidebarOpen = ref(true)
let requestSequence = 0
let collapseDrawerOnPlayable = false

const selectedProject = computed(() =>
  projects.value.find((project) => project.id === selectedProjectDir.value)
)
const selectedProjectName = computed(() => selectedProject.value?.name || '')
const availableGroups = computed(() => selectedProject.value?.groups || [])
const currentGroup = computed(() =>
  availableGroups.value.find((group) => group.name === selectedGroup.value)
)
const availableContestants = computed(() => currentGroup.value?.players || [])
const referees = computed(() => {
  const unique = new Map()
  events.value.forEach((event) => unique.set(event.referee_index, event.referee_name))
  return [...unique].map(([index, name]) => ({ index, name })).sort((a, b) => a.index - b.index)
})
const filteredEvents = computed(() =>
  selectedReferee.value === 'all'
    ? events.value
    : events.value.filter((event) => String(event.referee_index) === selectedReferee.value)
)
const currentReplayBinding = computed(() => {
  const historical = bindingVersions.value.find(
    (item) => item.id === selectedBindingVersionId.value
  )
  const source =
    binding.value?.version_id === selectedBindingVersionId.value ? binding.value : historical
  return source
    ? {
        ...source,
        version_id: source.version_id || source.id,
        updated_at: source.updated_at || source.created_at
      }
    : null
})
const replayScores = computed(() => {
  return buildReplayScores(
    events.value,
    currentGroup.value?.referees || [],
    selectedBindingVersionId.value,
    playbackTimeMs.value
  )
})
const visibleReplayScores = computed(() => {
  if (selectedReferee.value === 'all') return replayScores.value
  const score = replayScores.value[selectedReferee.value]
  return score ? { [selectedReferee.value]: score } : {}
})

onMounted(async () => {
  projects.value = await competitionStore.fetchHistoryProjects()
  const requestedCompetition = String(route.query.competition || '')
  if (projects.value.some((project) => project.id === requestedCompetition)) {
    collapseDrawerOnPlayable = true
    selectedProjectDir.value = requestedCompetition
  }
})

const handleProjectSelected = () => {
  collapseDrawerOnPlayable = true
}

watch(selectedProjectDir, () => {
  const requestedGroup =
    selectedProjectDir.value === String(route.query.competition || '')
      ? String(route.query.group || '')
      : ''
  selectedGroup.value = availableGroups.value.some((group) => group.name === requestedGroup)
    ? requestedGroup
    : availableGroups.value[0]?.name || ''
  selectedReferee.value = 'all'
})

watch(selectedGroup, () => {
  const requestedContestant =
    selectedProjectDir.value === String(route.query.competition || '') &&
    selectedGroup.value === String(route.query.group || '')
      ? String(route.query.contestant || '')
      : ''
  selectedContestant.value = availableContestants.value.includes(requestedContestant)
    ? requestedContestant
    : availableContestants.value[0] || ''
  selectedReferee.value =
    selectedProjectDir.value === String(route.query.competition || '') &&
    selectedGroup.value === String(route.query.group || '')
      ? String(route.query.referee || 'all')
      : 'all'
})

watch(
  [selectedProjectDir, selectedGroup, selectedContestant, selectedReferee],
  ([competition, group, contestant, referee]) => {
    const query = {
      ...(competition ? { competition } : {}),
      ...(group ? { group } : {}),
      ...(contestant ? { contestant } : {}),
      ...(referee !== 'all' ? { referee } : {})
    }
    if (JSON.stringify(route.query) !== JSON.stringify(query)) void router.replace({ query })
  },
  { flush: 'post' }
)

watch(
  [selectedProjectDir, selectedGroup, selectedContestant],
  async ([dirName, groupName, contestantName]) => {
    const sequence = ++requestSequence
    binding.value = null
    events.value = []
    selectedBindingVersionId.value = ''
    replayPlaybackSessionId.value = `replay-${sequence}`
    playbackTimeMs.value = 0
    activeEventId.value = ''
    if (!dirName || !groupName || !contestantName) return
    loading.value = true
    const data = await replayStore.fetchReplayData(dirName, groupName, contestantName)
    if (sequence !== requestSequence) return
    binding.value = data?.binding || null
    bindingVersions.value = data?.binding_versions || []
    events.value = data?.events || []
    const alignedVersion = [...events.value]
      .reverse()
      .find(
        (event) => event.media_sync_status === 'aligned' && event.media_binding_version_id
      )?.media_binding_version_id
    selectedBindingVersionId.value = alignedVersion || binding.value?.version_id || ''
    if (collapseDrawerOnPlayable && currentReplayBinding.value) sidebarOpen.value = false
    collapseDrawerOnPlayable = false
    loading.value = false
  }
)

const isAligned = (event) =>
  event.media_sync_status === 'aligned' &&
  event.media_time_ms != null &&
  event.media_binding_version_id

const jumpToEvent = async (event) => {
  if (!isAligned(event)) return
  selectedBindingVersionId.value = event.media_binding_version_id
  playbackTimeMs.value = event.media_time_ms
  activeEventId.value = event.event_id
  await nextTick()
  await playerRef.value?.seekTo?.(event.media_time_ms)
  sidebarOpen.value = false
}

const handlePlayback = (playback) => {
  playbackTimeMs.value = playback.position_ms
  const candidates = filteredEvents.value.filter(
    (event) =>
      isAligned(event) &&
      event.media_binding_version_id === playback.binding_version_id &&
      event.media_id === playback.media_id
  )
  if (!candidates.length) {
    activeEventId.value = ''
    return
  }
  activeEventId.value = candidates.reduce((nearest, event) =>
    Math.abs(event.media_time_ms - playback.position_ms) <
    Math.abs(nearest.media_time_ms - playback.position_ms)
      ? event
      : nearest
  ).event_id
}

const formatMediaTime = (milliseconds) => {
  if (milliseconds == null) return '--:--.---'
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`
}
const formatSystemTime = (value) => value?.split(' ')[1] || value || ''
const roleLabel = (role) => (role === 'SECONDARY' ? t('replay_secondary') : t('replay_primary'))
const formatDelta = (event) => {
  const changes = []
  if (event.delta_plus) changes.push(`+${event.delta_plus}`)
  if (event.delta_minus) changes.push(`-${event.delta_minus}`)
  if (event.delta_penalty) changes.push(`${t('replay_penalty')} -${event.delta_penalty}`)
  return changes.join(' / ') || '0'
}
const syncStatusLabel = (status) => t(`replay_sync_${status || 'not_ready'}`)
</script>

<style scoped>
.replay-view {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--workbench-bg);
  color: var(--workbench-text);
}
.replay-header {
  position: absolute;
  top: 14px;
  left: 56px;
  right: 16px;
  z-index: 10;
  min-height: 36px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  pointer-events: none;
}
.replay-header > button,
.replay-header > .score-display-mode-switch {
  pointer-events: auto;
}
.replay-header h2 {
  margin: 0;
  color: rgba(255, 255, 255, 0.62);
  font-size: 1.05rem;
  letter-spacing: 0;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.7);
}
.replay-subtitle {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.76rem;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.7);
}
.back-button {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.56);
  cursor: pointer;
  transition:
    color 0.16s ease,
    background-color 0.16s ease;
}
.back-button:hover,
.back-button:focus-visible {
  outline: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.replay-layout {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.replay-main {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.replay-media {
  position: absolute;
  inset: 0;
  min-width: 0;
  height: 100%;
}
.replay-media :deep(.player-frame) {
  border-radius: 0;
}
.replay-score-overlay {
  z-index: 6;
}
.replay-sidebar {
  --drawer-width: min(300px, calc(100vw - 72px));
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--drawer-width);
  z-index: 11;
  transform: translateX(calc(-100% + 7px));
  transition: transform 0.2s ease;
}
.replay-sidebar.open {
  transform: translateX(0);
}
.replay-sidebar-content {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 16px 14px;
  border-right: 1px solid var(--workbench-border-subtle);
  background: color-mix(in srgb, var(--workbench-surface) 96%, transparent);
  box-shadow: 10px 0 28px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(12px);
  overflow: hidden;
}
.replay-sidebar:not(.open) .replay-sidebar-content > * {
  opacity: 0;
}
.replay-sidebar-title {
  flex: 0 0 auto;
  min-height: 30px;
  color: var(--workbench-text);
  font-size: 0.86rem;
  font-weight: 650;
}
.replay-sidebar-rail {
  position: absolute;
  inset: 0 0 0 auto;
  width: 7px;
  z-index: 1;
  background: rgba(255, 255, 255, 0.1);
  cursor: ew-resize;
  transition:
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}
.replay-sidebar-rail::after {
  content: '';
  position: absolute;
  top: 0;
  right: 2px;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.28);
}
.replay-sidebar-rail:hover,
.replay-sidebar-rail:focus-visible {
  outline: none;
  background: color-mix(in srgb, var(--workbench-accent) 18%, transparent);
  box-shadow: 2px 0 10px color-mix(in srgb, var(--workbench-accent) 28%, transparent);
}
.replay-filters {
  flex: 0 0 auto;
}
.replay-sidebar label {
  display: block;
  margin-bottom: 14px;
}
.replay-sidebar label > span {
  display: block;
  margin-bottom: 6px;
  color: var(--workbench-muted-strong);
  font-size: 0.75rem;
}
.replay-sidebar select {
  width: 100%;
  height: 34px;
  border: 1px solid var(--workbench-border);
  border-radius: 4px;
  background: var(--workbench-input);
  color: var(--workbench-text);
  padding: 0 8px;
}
.timeline {
  min-height: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  border-top: 1px solid var(--workbench-border-subtle);
  padding-top: 12px;
}
.timeline-header {
  min-height: 32px;
  display: flex;
  flex: 0 0 auto;
  justify-content: space-between;
  align-items: center;
}
.timeline-header h3 {
  margin: 0;
  font-size: 0.9rem;
  letter-spacing: 0;
}
.timeline-header span {
  color: var(--workbench-muted);
  font-size: 0.8rem;
}
.event-list {
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--workbench-border-subtle);
}
.event-row {
  width: 100%;
  min-height: 82px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 5px 8px;
  padding: 9px 8px;
  border: 0;
  border-bottom: 1px solid var(--workbench-border-subtle);
  background: transparent;
  color: var(--workbench-text);
  text-align: left;
  cursor: pointer;
}
.event-row:hover:not(:disabled),
.event-row.active {
  background: var(--workbench-accent-soft);
  box-shadow: inset 3px 0 var(--workbench-accent);
}
.event-row.unaligned {
  color: var(--workbench-muted);
  cursor: default;
}
.video-time {
  color: var(--workbench-accent);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.78rem;
}
.event-system-time {
  color: var(--workbench-muted);
  font-size: 0.75rem;
}
.event-ref {
  grid-column: 1 / -1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8rem;
}
.event-delta {
  font-weight: 650;
  color: var(--workbench-text-secondary);
  font-size: 0.8rem;
}
.event-total {
  text-align: right;
  font-size: 0.78rem;
}
.sync-status {
  grid-column: 1 / -1;
  color: var(--workbench-danger);
  font-size: 0.72rem;
}
.timeline-empty,
.empty-replay {
  color: var(--workbench-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
}
.timeline-empty {
  flex: 1 1 auto;
  min-height: 80px;
  text-align: center;
  font-size: 0.8rem;
}
.empty-replay {
  position: absolute;
  inset: 0;
  flex-direction: column;
  gap: 10px;
  text-align: center;
  background: radial-gradient(
    circle at center,
    color-mix(in srgb, var(--workbench-surface) 60%, transparent),
    transparent 54%
  );
}
.empty-replay strong {
  color: var(--workbench-text-secondary);
  font-size: 1rem;
}
.empty-replay span {
  max-width: 360px;
  font-size: 0.82rem;
  line-height: 1.5;
}
.empty-replay button {
  margin-top: 4px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--workbench-accent);
  border-radius: 5px;
  background: var(--workbench-accent);
  color: #fff;
  cursor: pointer;
}
.empty-replay button:hover,
.empty-replay button:focus-visible {
  outline: none;
  filter: brightness(1.08);
}
@media (max-width: 700px) {
  .replay-header h2,
  .replay-subtitle {
    display: none;
  }
  .replay-sidebar {
    --drawer-width: min(280px, calc(100vw - 54px));
  }
}
</style>
