<template>
  <div class="youtube-player">
    <div class="player-frame">
      <div :id="elementId" class="iframe-host"></div>
      <div v-if="!videoId" class="player-placeholder">
        <VideoOff :size="28" />
        <span>{{ emptyText }}</span>
      </div>
      <div v-if="errorMessage" class="player-error">
        <CircleAlert :size="24" />
        <span>{{ errorMessage }}</span>
        <a v-if="videoId" :href="canonicalUrl" target="_blank" rel="noreferrer">
          <ExternalLink :size="15" />
          {{ openText }}
        </a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CircleAlert, ExternalLink, VideoOff } from 'lucide-vue-next'
import { loadYouTubeApi, playerStateName } from '../media/youtube'

const props = defineProps({
  videoId: { type: String, default: '' },
  syncEnabled: { type: Boolean, default: false },
  group: { type: String, default: '' },
  contestant: { type: String, default: '' },
  emptyText: { type: String, default: 'No video selected' },
  openText: { type: String, default: 'Open in browser' }
})
const emit = defineEmits(['playback', 'sync', 'error'])

const elementId = `youtube-player-${Math.random().toString(36).slice(2)}`
const errorMessage = ref('')
const canonicalUrl = computed(() => `https://www.youtube.com/watch?v=${props.videoId}`)
let player = null
let pollTimer = null
let destroyed = false
let pendingOpen = null

const getPlayback = () => {
  if (!player || typeof player.getCurrentTime !== 'function') return null
  const state = playerStateName(player.getPlayerState())
  if (state === 'not_ready') return null
  return {
    group: props.group,
    contestant: props.contestant,
    video_id: player.getVideoData?.().video_id || props.videoId,
    video_time_ms: Math.max(0, Math.round((player.getCurrentTime() || 0) * 1000)),
    state,
    playback_rate: player.getPlaybackRate?.() || 1
  }
}

const publishPlayback = () => {
  const playback = getPlayback()
  if (!playback) return
  emit('playback', playback)
  if (props.syncEnabled && playback.group && playback.contestant) emit('sync', playback)
}

const startPolling = () => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(publishPlayback, 100)
}

const createPlayer = async () => {
  if (!props.videoId || destroyed) return
  errorMessage.value = ''
  try {
    const YT = await loadYouTubeApi()
    if (destroyed) return
    await nextTick()
    player = new YT.Player(elementId, {
      videoId: props.videoId,
      width: '100%',
      height: '100%',
      playerVars: { controls: 1, playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          errorMessage.value = ''
          startPolling()
          if (pendingOpen) {
            const request = pendingOpen
            pendingOpen = null
            openAt(request.videoId, request.seconds, request.autoplay)
          }
          publishPlayback()
        },
        onStateChange: publishPlayback,
        onPlaybackRateChange: publishPlayback,
        onError: (event) => {
          const unavailable = [100, 101, 150].includes(event.data)
          errorMessage.value = unavailable
            ? 'This video is unavailable or does not allow embedding.'
            : 'YouTube could not play this video.'
          emit('error', { code: event.data, message: errorMessage.value })
        }
      }
    })
  } catch (error) {
    errorMessage.value = 'Unable to connect to YouTube. Check the network connection.'
    emit('error', { code: 'network', message: errorMessage.value, cause: error })
  }
}

const openAt = (videoId, seconds, autoplay = true) => {
  if (!videoId) return
  if (!player || typeof player.loadVideoById !== 'function') {
    pendingOpen = { videoId, seconds, autoplay }
    return
  }
  errorMessage.value = ''
  const options = { videoId, startSeconds: Math.max(0, Number(seconds) || 0) }
  if (autoplay) player.loadVideoById(options)
  else player.cueVideoById(options)
}

watch(
  () => props.videoId,
  async (videoId, oldVideoId) => {
    if (!videoId) {
      errorMessage.value = ''
      player?.stopVideo?.()
      return
    }
    if (!player) await createPlayer()
    else if (videoId !== oldVideoId) player.cueVideoById(videoId)
  }
)

watch(
  () => [props.group, props.contestant],
  () => publishPlayback()
)

onMounted(createPlayer)
onBeforeUnmount(() => {
  destroyed = true
  if (pollTimer) clearInterval(pollTimer)
  player?.destroy?.()
  player = null
})

defineExpose({ openAt })
</script>

<style scoped>
.youtube-player { width: 100%; height: 100%; min-height: 0; }
.player-frame { position: relative; width: 100%; height: 100%; min-height: 180px; background: #0b0b0b; overflow: hidden; border-radius: 6px; }
.iframe-host { width: 100%; height: 100%; }
.player-placeholder, .player-error { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #8d929b; text-align: center; padding: 24px; box-sizing: border-box; }
.player-error { background: rgba(12, 12, 12, 0.94); color: #e5e7eb; }
.player-error a { display: inline-flex; align-items: center; gap: 6px; color: #67b7ff; text-decoration: none; }
</style>
