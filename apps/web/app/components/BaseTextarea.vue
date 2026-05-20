<template>
  <textarea
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :rows="rows"
    class="base-textarea"
    @input="onInput"
  />
</template>

<script setup lang="ts">
defineProps<{
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  rows?: number
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}
</script>

<style scoped>
.base-textarea {
  width: 100%;
  min-height: 80px;
  padding: 10px 14px;
  border-radius: 11px;
  background: var(--p-surface-100);
  border: 1.5px solid var(--p-surface-300);
  color: var(--p-surface-900);
  font-size: 14.5px;
  font-family: inherit;
  line-height: 1.5;
  outline: 0;
  resize: vertical;
  transition: border-color 0.12s, box-shadow 0.12s;
}
[data-theme="dark"] .base-textarea {
  background: color-mix(in srgb, var(--p-surface-200) 50%, transparent);
}
.base-textarea::placeholder { color: var(--p-surface-400); }
.base-textarea:focus {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}
.base-textarea:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
