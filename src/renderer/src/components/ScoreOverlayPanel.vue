<template>
  <section
    ref="panelRef"
    class="score-overlay-panel"
    :class="{ draggable }"
  >
    <header
      v-if="showHeader"
      class="panel-header"
    >
      <div class="panel-identity">
        <span class="panel-label">{{ $t('media_score_overlay') }}</span>
        <strong>{{ contestant || $t('ov_contestant_waiting') }}</strong>
      </div>
      <ScoreDisplayModeSwitch v-model="displayMode" />
    </header>

    <div v-if="refereeEntries.length" class="overlay-score-grid">
      <article
        v-for="[key, referee] in refereeEntries"
        :key="key"
        :ref="(element) => setCardRef(key, element)"
        class="overlay-score-card"
        :class="{ dragging: draggingKey === key }"
        :style="cardStyle(key)"
      >
        <div
          class="referee-header"
          :class="{ 'drag-handle': draggable }"
          @pointerdown="startCardDrag($event, key)"
          @pointermove="moveCardDrag"
          @pointerup="stopCardDrag"
          @pointercancel="stopCardDrag"
        >
          <span>{{ referee.name || `${$t('lbl_referee')} ${key}` }}</span>
          <div class="referee-tools">
            <div v-if="referee.status" class="connection-status">
              <span :class="referee.status.pri || 'disconnected'"></span>
              <span
                v-if="referee.status.sec && referee.status.sec !== 'n/a'"
                :class="referee.status.sec"
              ></span>
            </div>
            <GripVertical v-if="draggable" class="drag-icon" :size="15" aria-hidden="true" />
          </div>
        </div>

        <RefereeScoreDisplay :referee="referee" :mode="displayMode" />
      </article>
    </div>
    <div v-else class="score-empty">{{ $t('media_score_empty') }}</div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import RefereeScoreDisplay from './RefereeScoreDisplay.vue'
import ScoreDisplayModeSwitch from './ScoreDisplayModeSwitch.vue'

const props = defineProps({
  referees: { type: Object, default: () => ({}) },
  contestant: { type: String, default: '' },
  showHeader: { type: Boolean, default: true },
  displayMode: { type: String, default: null },
  draggable: { type: Boolean, default: false },
  positionKey: { type: String, default: '' },
  initialX: { type: Number, default: 18 },
  initialY: { type: Number, default: 70 }
})
const emit = defineEmits(['update:displayMode'])
const internalDisplayMode = ref('COMBINED')
const panelRef = ref(null)
const cardRefs = new Map()
const cardPositions = ref({})
const draggingKey = ref(null)
let dragState = null
let resizeObserver = null
const CARD_WIDTH = 168
const CARD_HEIGHT = 100
const CARD_GAP = 8
const PANEL_INSET = 12

const displayMode = computed({
  get: () => props.displayMode || internalDisplayMode.value,
  set: (value) => {
    if (props.displayMode) emit('update:displayMode', value)
    else internalDisplayMode.value = value
  }
})
const refereeEntries = computed(() => Object.entries(props.referees || {}))

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const defaultPosition = (index) => {
  const panel = panelRef.value
  const availableHeight = panel?.clientHeight || window.innerHeight
  const rowsPerColumn = Math.max(
    1,
    Math.floor((availableHeight - props.initialY - PANEL_INSET + CARD_GAP) / (CARD_HEIGHT + CARD_GAP))
  )
  const row = index % rowsPerColumn
  const column = Math.floor(index / rowsPerColumn)
  return {
    x: props.initialX + column * (CARD_WIDTH + CARD_GAP),
    y: props.initialY + row * (CARD_HEIGHT + CARD_GAP)
  }
}

const clampCardPosition = (key, candidate = cardPositions.value[key]) => {
  const panel = panelRef.value
  const card = cardRefs.get(key)
  if (!props.draggable || !panel || !card || !candidate) return candidate

  const maxX = Math.max(PANEL_INSET, panel.clientWidth - card.offsetWidth - PANEL_INSET)
  const maxY = Math.max(PANEL_INSET, panel.clientHeight - card.offsetHeight - PANEL_INSET)
  const next = {
    x: clamp(Math.round(candidate.x), PANEL_INSET, maxX),
    y: clamp(Math.round(candidate.y), PANEL_INSET, maxY)
  }
  const current = cardPositions.value[key]
  if (!current || current.x !== next.x || current.y !== next.y) {
    cardPositions.value = { ...cardPositions.value, [key]: next }
  }
  return next
}

const loadPositions = () => {
  if (!props.draggable || !props.positionKey) return
  try {
    const saved = JSON.parse(localStorage.getItem(props.positionKey) || '{}')
    cardPositions.value = Object.fromEntries(
      Object.entries(saved).filter(
        ([, value]) => Number.isFinite(value?.x) && Number.isFinite(value?.y)
      )
    )
  } catch {
    // Ignore invalid persisted card positions.
  }
}

const savePositions = () => {
  if (!props.draggable || !props.positionKey) return
  localStorage.setItem(props.positionKey, JSON.stringify(cardPositions.value))
}

const ensureCardPositions = () => {
  if (!props.draggable) return
  const next = { ...cardPositions.value }
  refereeEntries.value.forEach(([key], index) => {
    if (!next[key]) next[key] = defaultPosition(index)
  })
  cardPositions.value = next
  nextTick(() => refereeEntries.value.forEach(([key]) => clampCardPosition(key)))
}

const cardStyle = (key) => {
  if (!props.draggable) return undefined
  const position = cardPositions.value[key] || { x: props.initialX, y: props.initialY }
  return {
    left: `${position.x}px`,
    top: `${position.y}px`,
    zIndex: draggingKey.value === key ? 2 : 1
  }
}

const setCardRef = (key, element) => {
  if (!element) {
    cardRefs.delete(key)
    return
  }
  cardRefs.set(key, element)
  resizeObserver?.observe(element)
}

const startCardDrag = (event, key) => {
  if (!props.draggable || event.button !== 0 || event.target.closest('button')) return
  const handle = event.currentTarget
  handle.setPointerCapture?.(event.pointerId)
  const position = cardPositions.value[key] || defaultPosition(0)
  dragState = {
    key,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    cardX: position.x,
    cardY: position.y
  }
  draggingKey.value = key
  event.preventDefault()
}

const moveCardDrag = (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  clampCardPosition(dragState.key, {
    x: dragState.cardX + event.clientX - dragState.startX,
    y: dragState.cardY + event.clientY - dragState.startY
  })
}

const stopCardDrag = (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  event.currentTarget.releasePointerCapture?.(event.pointerId)
  dragState = null
  draggingKey.value = null
  savePositions()
}

onMounted(async () => {
  if (!props.draggable) return
  loadPositions()
  await nextTick()
  ensureCardPositions()
  resizeObserver = new ResizeObserver(() => {
    refereeEntries.value.forEach(([key]) => clampCardPosition(key))
  })
  if (panelRef.value) resizeObserver.observe(panelRef.value)
  cardRefs.forEach((card) => resizeObserver.observe(card))
})

watch(
  () => refereeEntries.value.map(([key]) => key).join('|'),
  () => ensureCardPositions()
)

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped>
.score-overlay-panel { min-width: 0; color: var(--workbench-text); }
.score-overlay-panel.draggable { position: absolute; inset: 0; box-sizing: border-box; pointer-events: none; user-select: none; }
.panel-header { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.drag-icon { flex: 0 0 auto; margin-left: 3px; }
.panel-identity { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.panel-label { color: var(--workbench-muted); font-size: 0.72rem; }
.panel-identity strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; }
.overlay-score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.draggable .overlay-score-grid { position: absolute; inset: 0; display: block; pointer-events: none; }
.overlay-score-card { min-width: 0; min-height: 94px; box-sizing: border-box; display: flex; flex-direction: column; padding: 10px 12px; border-left: 4px solid var(--workbench-accent); border-radius: 4px; background: color-mix(in srgb, var(--workbench-surface) 92%, transparent); box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.35); }
.draggable .overlay-score-card { position: absolute; width: 168px; min-height: 94px; padding: 8px 10px; pointer-events: auto; }
.referee-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 5px; border-bottom: 1px solid var(--workbench-border); color: var(--workbench-text-secondary); font-size: 0.76rem; }
.referee-header.drag-handle { cursor: grab; touch-action: none; }
.overlay-score-card.dragging .referee-header.drag-handle { color: var(--workbench-text); cursor: grabbing; }
.referee-tools { display: inline-flex; align-items: center; gap: 5px; }
.connection-status { display: inline-flex; gap: 4px; }
.connection-status span { width: 6px; height: 6px; border-radius: 50%; background: #666; }
.connection-status span.connected { background: #2ecc71; }
.connection-status span.connecting { background: #e0ad42; }
.score-empty { min-height: 110px; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--workbench-border); border-radius: 5px; color: var(--workbench-muted); font-size: 0.8rem; }
.draggable .score-empty { position: absolute; top: 70px; left: 18px; width: min(260px, calc(100% - 36px)); pointer-events: none; }
@media (max-width: 560px) {
  .panel-header { align-items: flex-start; flex-direction: column; }
  .overlay-score-grid { grid-template-columns: 1fr; }
  .draggable .overlay-score-grid { display: block; }
}
</style>
