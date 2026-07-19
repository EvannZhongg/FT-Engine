<template>
  <DialogShell
    :open="open"
    :aria-label="title"
    :close-on-backdrop="!busy"
    :close-on-escape="!busy"
    @close="emit('cancel')"
  >
    <section class="app-dialog">
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <div class="dialog-actions">
        <button type="button" class="button-secondary" :disabled="busy" @click="emit('cancel')">
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
  </DialogShell>
</template>

<script setup>
import DialogShell from './DialogShell.vue'

defineProps({
  open: Boolean,
  title: { type: String, required: true },
  message: { type: String, required: true },
  confirmText: { type: String, required: true },
  cancelText: { type: String, required: true },
  danger: Boolean,
  busy: Boolean
})
const emit = defineEmits(['confirm', 'cancel'])
</script>

<style scoped>
.app-dialog {
  display: contents;
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
