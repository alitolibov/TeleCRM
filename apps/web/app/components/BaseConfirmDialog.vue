<script setup lang="ts">
import BaseButton from '~/components/BaseButton.vue'

withDefaults(defineProps<{
  open: boolean
  /** PrimeIcons class, e.g. `pi pi-shield`. */
  icon: string
  /** Color theme of the icon halo. */
  iconVariant?: 'primary' | 'danger' | 'warning'
  title: string
  /** Confirm button label + visual variant. */
  confirmLabel: string
  confirmVariant?: 'primary' | 'danger'
  cancelLabel?: string
  loading?: boolean
  disabled?: boolean
}>(), {
  iconVariant: 'primary',
  confirmVariant: 'primary',
  cancelLabel: 'Отмена',
})

defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm'): void
}>()
</script>

<template>
  <Dialog
    :visible="open"
    @update:visible="$emit('update:open', $event)"
    modal
    :showHeader="false"
    :closable="false"
    :draggable="false"
    :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 420px; width: 92vw;' } }"
  >
    <div class="confirm-dialog">
      <div class="confirm-icon" :class="`confirm-icon-${iconVariant}`">
        <i :class="icon" />
      </div>
      <div class="confirm-text">
        <h3 class="confirm-title">{{ title }}</h3>
        <div class="confirm-body">
          <slot />
        </div>
        <p v-if="$slots.hint" class="confirm-hint">
          <slot name="hint" />
        </p>
      </div>
      <div class="confirm-actions">
        <BaseButton
          variant="secondary"
          class="flex-1"
          :disabled="loading"
          @click="$emit('update:open', false)"
        >{{ cancelLabel }}</BaseButton>
        <BaseButton
          :variant="confirmVariant"
          class="flex-1"
          :loading="loading"
          :disabled="disabled || loading"
          @click="$emit('confirm')"
        >{{ confirmLabel }}</BaseButton>
      </div>
    </div>
  </Dialog>
</template>

<style>
/* Global (not scoped) — applies inside teleported PrimeVue Dialog. */
.confirm-dialog {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 24px 20px;
  gap: 14px;
}
.confirm-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.confirm-icon > i { font-size: 22px; }
.confirm-icon-primary {
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
}
.confirm-icon-danger {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}
.confirm-icon-warning {
  background: rgba(217, 119, 6, 0.14);
  color: #d97706;
}
.confirm-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.confirm-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--p-surface-900);
  line-height: 1.3;
}
.confirm-body {
  font-size: 13.5px;
  color: var(--p-surface-500);
  line-height: 1.5;
  max-width: 320px;
}
.confirm-hint {
  font-size: 12px;
  color: var(--p-surface-400);
  line-height: 1.45;
  max-width: 320px;
  margin-top: 2px;
}
.confirm-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 6px;
}
</style>
