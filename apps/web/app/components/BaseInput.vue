<template>
  <div class="base-input-wrap" :class="{ 'base-input-focus': focused, 'base-input-disabled': disabled }">
    <span v-if="$slots.prefix || prefix" class="base-input-prefix">
      <slot name="prefix">{{ prefix }}</slot>
    </span>
    <input
      ref="inputEl"
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      class="base-input"
      v-bind="$attrs"
      @input="onInput"
      @focus="focused = true"
      @blur="focused = false"
    />
    <span v-if="$slots.suffix" class="base-input-suffix">
      <slot name="suffix" />
    </span>
  </div>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  modelValue?: string | number | null
  type?: string
  placeholder?: string
  disabled?: boolean
  autocomplete?: string
  inputmode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url' | 'search' | 'none'
  prefix?: string
  /** Filter for `input` events. Receives raw value, returns sanitized. */
  sanitize?: (raw: string) => string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const inputEl = ref<HTMLInputElement>()
const focused = ref(false)

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  const cleaned = props.sanitize ? props.sanitize(target.value) : target.value
  if (target.value !== cleaned) target.value = cleaned
  emit('update:modelValue', cleaned)
}
</script>

<style scoped>
.base-input-wrap {
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  border-radius: 11px;
  background: var(--p-surface-100);
  border: 1.5px solid var(--p-surface-300);
  transition: border-color 0.12s, box-shadow 0.12s;
  overflow: hidden;
}
[data-theme="dark"] .base-input-wrap {
  background: color-mix(in srgb, var(--p-surface-200) 50%, transparent);
}
.base-input-focus {
  border-color: var(--p-primary-color) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}
.base-input-disabled { opacity: 0.55; cursor: not-allowed; }
.base-input-disabled .base-input { cursor: not-allowed; }

.base-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 14px;
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 14.5px;
  font-family: inherit;
  color: var(--p-surface-900);
}
.base-input::placeholder { color: var(--p-surface-400); }

.base-input-prefix {
  padding: 0 4px 0 14px;
  color: var(--p-surface-400);
  font-size: 14.5px;
  font-weight: 600;
  user-select: none;
}
.base-input-prefix + .base-input { padding-left: 4px; }

.base-input-suffix {
  padding: 0 12px 0 4px;
  color: var(--p-surface-400);
  display: flex;
  align-items: center;
}
</style>
