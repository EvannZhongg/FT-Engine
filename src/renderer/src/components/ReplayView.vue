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
    </header>

    <div class="replay-layout">
      <aside class="replay-sidebar">
        <label>
          <span>{{ $t('replay_project') }}</span>
          <select v-model="selectedProjectDir">
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
            <option v-for="contestant in availableContestants" :key="contestant" :value="contestant">
              {{ contestant }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ $t('replay_referee') }}</span>
          <select v-model="selectedReferee" :disabled="events.length === 0">
            <option value="all">{{ $t('replay_all_referees') }}</option>
            <option v-for="referee in referees" :key="referee.index" :value="String(referee.index)">
              {{ referee.name }}
            </option>
          </select>
        </label>
      </aside>

      <main class="replay-main">
        <div v-if="!selectedProjectDir" class="empty-replay">
          <FolderOpen :size="32" />
          {{ $t('replay_choose_project') }}
        </div>
        <template v-else>
          <section class="replay-media">
            <YouTubePlayer
              ref="playerRef"
              :video-id="currentVideoId"
              :empty-text="$t('media_empty')"
              :open-text="$t('media_open_browser')"
              @playback="handlePlayback"
            />
            <ScoreOverlayPanel
              v-if="currentVideoId"
              class="replay-score-overlay"
              :referees="visibleReplayScores"
              :contestant="selectedContestant"
            />
          </section>

          <section class="timeline">
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
        </template>
      </main>
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
import YouTubePlayer from './YouTubePlayer.vue'

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
const events = ref([])
const currentVideoId = ref('')
const playbackTimeMs = ref(0)
const activeEventId = ref('')
const loading = ref(false)
const playerRef = ref(null)
let requestSequence = 0

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
const replayScores = computed(() => {
  return buildReplayScores(
    events.value,
    currentGroup.value?.referees || [],
    currentVideoId.value,
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
    selectedProjectDir.value = requestedCompetition
  }
})

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
    currentVideoId.value = ''
    playbackTimeMs.value = 0
    activeEventId.value = ''
    if (!dirName || !groupName || !contestantName) return
    loading.value = true
    const data = await replayStore.fetchReplayData(dirName, groupName, contestantName)
    if (sequence !== requestSequence) return
    binding.value = data?.binding || null
    events.value = data?.events || []
    currentVideoId.value = binding.value?.video_id || events.value.find((event) => event.media_id)?.media_id || ''
    loading.value = false
  }
)

const isAligned = (event) => event.media_sync_status === 'aligned' && event.media_time_ms != null && event.media_id

const jumpToEvent = async (event) => {
  if (!isAligned(event)) return
  currentVideoId.value = event.media_id
  playbackTimeMs.value = event.media_time_ms
  activeEventId.value = event.event_id
  await nextTick()
  playerRef.value?.openAt(event.media_id, event.media_time_ms / 1000, true)
}

const handlePlayback = (playback) => {
  playbackTimeMs.value = playback.video_time_ms
  const candidates = filteredEvents.value.filter(
    (event) => isAligned(event) && event.media_id === playback.video_id
  )
  if (!candidates.length) {
    activeEventId.value = ''
    return
  }
  activeEventId.value = candidates.reduce((nearest, event) =>
    Math.abs(event.media_time_ms - playback.video_time_ms) <
    Math.abs(nearest.media_time_ms - playback.video_time_ms)
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
.replay-view { height: 100%; display: flex; flex-direction: column; background: var(--workbench-bg); color: var(--workbench-text); }
.replay-header { height: 64px; flex: 0 0 64px; display: flex; align-items: center; gap: 12px; padding: 0 18px; border-bottom: 1px solid var(--workbench-border-subtle); box-sizing: border-box; }
.replay-header h2 { margin: 0; font-size: 1.05rem; letter-spacing: 0; }
.replay-subtitle { color: var(--workbench-muted); font-size: 0.76rem; margin-top: 2px; }
.back-button { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--workbench-border); border-radius: 5px; background: var(--workbench-surface-raised); color: var(--workbench-text); cursor: pointer; }
.replay-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
.replay-sidebar { padding: 18px 14px; border-right: 1px solid var(--workbench-border-subtle); background: var(--workbench-surface); overflow-y: auto; }
.replay-sidebar label { display: block; margin-bottom: 16px; }
.replay-sidebar label > span { display: block; margin-bottom: 6px; color: var(--workbench-muted-strong); font-size: 0.75rem; }
.replay-sidebar select { width: 100%; height: 34px; border: 1px solid var(--workbench-border); border-radius: 4px; background: var(--workbench-input); color: var(--workbench-text); padding: 0 8px; }
.replay-main { min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(320px, 0.95fr) minmax(360px, 1.05fr); gap: 18px; padding: 18px; box-sizing: border-box; overflow: hidden; }
.replay-media { align-self: start; min-width: 0; }
.replay-score-overlay { margin-top: 14px; }
.timeline { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--workbench-border-subtle); padding-left: 18px; }
.timeline-header { min-height: 32px; display: flex; justify-content: space-between; align-items: center; }
.timeline-header h3 { margin: 0; font-size: 0.95rem; letter-spacing: 0; }
.timeline-header span { color: var(--workbench-muted); font-size: 0.8rem; }
.event-list { min-height: 0; overflow-y: auto; border-top: 1px solid var(--workbench-border-subtle); }
.event-row { width: 100%; min-height: 62px; display: grid; grid-template-columns: 78px 78px minmax(120px, 1fr) minmax(80px, auto) 72px; align-items: center; gap: 8px; padding: 9px 8px; border: 0; border-bottom: 1px solid var(--workbench-border-subtle); background: transparent; color: var(--workbench-text); text-align: left; cursor: pointer; }
.event-row:hover:not(:disabled), .event-row.active { background: var(--workbench-accent-soft); box-shadow: inset 3px 0 var(--workbench-accent); }
.event-row.unaligned { color: var(--workbench-muted); cursor: default; }
.video-time { color: var(--workbench-accent); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.78rem; }
.event-system-time { color: var(--workbench-muted); font-size: 0.75rem; }
.event-ref { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem; }
.event-delta { font-weight: 650; color: var(--workbench-text-secondary); font-size: 0.8rem; }
.event-total { text-align: right; font-size: 0.78rem; }
.sync-status { grid-column: 3 / -1; color: var(--workbench-danger); font-size: 0.72rem; }
.timeline-empty, .empty-replay { color: var(--workbench-muted); display: flex; align-items: center; justify-content: center; min-height: 160px; }
.empty-replay { grid-column: 1 / -1; flex-direction: column; gap: 10px; }
@media (max-width: 900px) {
  .replay-main { grid-template-columns: 1fr; overflow-y: auto; }
  .timeline { min-height: 360px; border-left: 0; padding-left: 0; }
}
</style>
