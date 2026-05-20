<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="base-btn"
    :class="[`base-btn-${variant}`, `base-btn-${size}`]"
    @click="$emit('click', $event)"
  >
    <i v-if="loading" class="pi pi-spin pi-spinner" />
    <i v-else-if="icon" :class="icon" />
    <span v-if="$slots.default || label">
      <slot>{{ label }}</slot>
    </span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
  icon?: string
  variant?: 'primary' | 'secondary' | 'text' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  loading?: boolean
}>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
})

defineEmits<{ click: [event: MouseEvent] }>()
</script>

<style scoped>
.base-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 11px;
  font-family: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: transform 0.12s, filter 0.12s, background 0.12s, color 0.12s, opacity 0.12s;
  user-select: none;
}
.base-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Sizes */
.base-btn-sm { height: 32px; padding: 0 12px; font-size: 12.5px; gap: 6px; border-radius: 9px; }
.base-btn-md { height: 40px; padding: 0 16px; font-size: 14px; }
.base-btn-lg { height: 46px; padding: 0 20px; font-size: 15px; font-weight: 700; }

/* Primary — gradient with glow */
.base-btn-primary {
  background: linear-gradient(135deg, var(--p-primary-color) 0%, #a78bfa 100%);
  color: #fff;
  box-shadow: 0 4px 14px color-mix(in srgb, var(--p-primary-color) 30%, transparent);
}
.base-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.06);
}
.base-btn-primary:active:not(:disabled) { transform: translateY(0); }

/* Secondary — outlined */
.base-btn-secondary {
  background: transparent;
  color: var(--p-surface-800);
  border: 1.5px solid var(--p-surface-300);
}
[data-theme="dark"] .base-btn-secondary { color: var(--p-surface-700); }
.base-btn-secondary:hover:not(:disabled) {
  background: var(--p-surface-100);
  border-color: var(--p-surface-400);
}

/* Text — ghost */
.base-btn-text {
  background: transparent;
  color: var(--p-surface-600);
}
.base-btn-text:hover:not(:disabled) {
  background: var(--p-surface-100);
  color: var(--p-surface-900);
}

/* Danger */
.base-btn-danger {
  background: var(--p-red-500, #ef4444);
  color: #fff;
}
.base-btn-danger:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
</style>
