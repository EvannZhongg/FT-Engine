<template>
  <div class="media-player">
    <div class="player-frame">
      <div v-if="binding?.provider === 'youtube'" ref="youtubeHost" class="youtube-host"></div>
      <iframe
        v-else-if="binding?.provider === 'bilibili'"
        ref="bilibiliFrame"
        class="bilibili-frame"
        title="Bilibili player"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-presentation"
      ></iframe>
      <div v-else class="player-placeholder">
        <VideoOff :size="28" />
        <span>{{ emptyText }}</span>
      </div>
      <div v-if="errorMessage" class="player-error">
        <CircleAlert :size="24" />
        <span>{{ errorMessage }}</span>
        <a
          v-if="binding?.canonical_url"
          :href="binding.canonical_url"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink :size="15" />
          {{ openText }}
        </a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { CircleAlert, ExternalLink, VideoOff } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { BilibiliPlayerAdapter } from '../media/adapters/bilibili-player-adapter.js'
import { YouTubePlayerAdapter } from '../media/adapters/youtube-player-adapter.js'

const props = defineProps({
  binding: { type: Object, default: null },
  playbackSessionId: { type: String, default: '' },
  progressMode: { type: String, default: 'reset' },
  continuityPositionMs: { type: Number, default: null },
  emptyText: { type: String, default: 'No video selected' },
  openText: { type: String, default: 'Open in browser' }
})
const emit = defineEmits(['snapshot', 'error'])
const { t } = useI18n()
const youtubeHost = ref(null)
const bilibiliFrame = ref(null)
const errorMessage = ref('')
let adapter = null
let adapterProvider = ''
let loadToken = 0
let currentLoadPromise = Promise.resolve()

const destroyAdapter = async () => {
  if (adapter) await adapter.destroy()
  adapter = null
  adapterProvider = ''
}

const loadBinding = async () => {
  const token = ++loadToken
  errorMessage.value = ''
  if (!props.binding || !props.playbackSessionId) {
    await destroyAdapter()
    return
  }
  if (adapter && adapterProvider !== props.binding.provider) await destroyAdapter()
  await nextTick()
  if (token !== loadToken) return
  try {
    if (!adapter && props.binding.provider === 'youtube') {
      adapter = new YouTubePlayerAdapter(youtubeHost.value, {
        onSnapshot: (snapshot) => emit('snapshot', snapshot),
        onError: (error) => handleError(error)
      })
      adapterProvider = 'youtube'
    } else if (!adapter && props.binding.provider === 'bilibili') {
      adapter = new BilibiliPlayerAdapter(bilibiliFrame.value)
      adapterProvider = 'bilibili'
    } else if (!adapter) {
      throw new Error('MEDIA_URL_UNSUPPORTED')
    }
    await adapter.load(
      props.binding,
      props.playbackSessionId,
      props.progressMode,
      props.continuityPositionMs
    )
  } catch (error) {
    handleError(error)
  }
}

const handleError = (error) => {
  const code = error?.code || error?.message || 'MEDIA_PLAYER_UNAVAILABLE'
  errorMessage.value =
    code === 'MEDIA_PROGRESS_CONTINUITY_UNAVAILABLE'
      ? t('media_player_continuity_error')
      : t('media_player_load_error')
  emit('error', { code, cause: error })
}

const scheduleLoad = () => {
  currentLoadPromise = currentLoadPromise.catch(() => {}).then(loadBinding)
}

watch(
  () => [
    props.binding?.version_id,
    props.playbackSessionId,
    props.progressMode,
    props.continuityPositionMs
  ],
  scheduleLoad,
  { immediate: true }
)
onBeforeUnmount(destroyAdapter)

defineExpose({
  seekTo: async (positionMs) => {
    await currentLoadPromise
    return adapter?.seekTo(positionMs)
  },
  getSnapshot: async () => {
    await currentLoadPromise
    return adapter?.getSnapshot?.() || null
  }
})
</script>

<style scoped>
.media-player {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.player-frame {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 180px;
  overflow: hidden;
  background: #0b0b0b;
  border-radius: 6px;
}
.youtube-host,
.bilibili-frame {
  width: 100%;
  height: 100%;
  border: 0;
}
.player-placeholder,
.player-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  box-sizing: border-box;
  color: #8d929b;
  text-align: center;
}
.player-error {
  background: rgba(12, 12, 12, 0.94);
  color: #e5e7eb;
}
.player-error a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #67b7ff;
  text-decoration: none;
}
</style>
