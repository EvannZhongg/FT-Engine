<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="emit('cancel')">
      <section
        ref="dialogRef"
        class="app-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @keydown="handleKeydown"
      >
        <h2 :id="titleId">{{ title }}</h2>
        <p>{{ message }}</p>
        <div class="dialog-actions">
          <button
            ref="cancelRef"
            type="button"
            class="button-secondary"
            :disabled="busy"
            @click="emit('cancel')"
          >
            {{ cancelText }}
          </button>
          <button
            type="button"
            :class="danger ? 'button-danger' : 'button-primary'"
            :disabled="busy"
            @click="emit('confirm')"
          >
            {{ confirmText }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  title: { type: String, required: true },
  message: { type: String, required: true },
  confirmText: { type: String, required: true },
  cancelText: { type: String, required: true },
  danger: Boolean,
  busy: Boolean
})
const emit = defineEmits(['confirm', 'cancel'])
const dialogRef = ref(null)
const cancelRef = ref(null)
const titleId = `dialog-title-${Math.random().toString(36).slice(2)}`

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    cancelRef.value?.focus()
  }
)

const handleKeydown = (event) => {
  if (event.key === 'Escape' && !props.busy) emit('cancel')
  if (event.key !== 'Tab') return
  const focusable = [...dialogRef.value.querySelectorAll('button:not(:disabled)')]
  if (!focusable.length) return
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
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 18, 16, 0.48);
}
.app-dialog {
  width: min(430px, 100%);
  padding: 22px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-primary);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.24);
}
.app-dialog h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}
.app-dialog p {
  margin: 12px 0 22px;
  color: var(--text-secondary);
  font-size: 0.84rem;
  line-height: 1.6;
  white-space: pre-line;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
</style>
