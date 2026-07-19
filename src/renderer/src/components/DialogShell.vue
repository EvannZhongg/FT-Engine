<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-shell-backdrop" @mousedown.self="handleBackdrop">
      <section
        ref="surfaceRef"
        class="dialog-shell-surface"
        :class="`variant-${variant}`"
        :style="surfaceStyle"
        role="dialog"
        aria-modal="true"
        :aria-label="ariaLabel"
        @keydown="handleKeydown"
      >
        <slot />
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  ariaLabel: { type: String, required: true },
  width: { type: String, default: '430px' },
  height: { type: String, default: 'auto' },
  padding: { type: String, default: '22px' },
  variant: { type: String, default: 'app' },
  closeOnBackdrop: { type: Boolean, default: true },
  closeOnEscape: { type: Boolean, default: true },
  initialFocus: { type: String, default: '[autofocus], button:not(:disabled)' }
})
const emit = defineEmits(['close'])
const surfaceRef = ref(null)
let previouslyFocused = null

const surfaceStyle = computed(() => ({
  width: `min(${props.width}, calc(100vw - 48px))`,
  height: props.height,
  padding: props.padding
}))

const focusableElements = () => [
  ...surfaceRef.value.querySelectorAll(
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )
]

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused = document.activeElement
      await nextTick()
      surfaceRef.value?.querySelector(props.initialFocus)?.focus()
      return
    }
    previouslyFocused?.focus?.()
    previouslyFocused = null
  }
)

onUnmounted(() => previouslyFocused?.focus?.())

const handleBackdrop = () => {
  if (props.closeOnBackdrop) emit('close')
}

const handleKeydown = (event) => {
  if (event.key === 'Escape' && props.closeOnEscape) {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const focusable = focusableElements()
  if (!focusable.length) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<style scoped>
.dialog-shell-backdrop {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 18, 16, 0.56);
}
.dialog-shell-surface {
  max-height: calc(100vh - 48px);
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-primary);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.24);
}
.variant-workbench {
  border-color: var(--workbench-border);
  background: var(--workbench-surface-raised);
  color: var(--workbench-text);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.42);
}
</style>
