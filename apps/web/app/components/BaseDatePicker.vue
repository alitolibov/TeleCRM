<template>
  <DatePicker
    :modelValue="modelValue"
    :selectionMode="selectionMode"
    :manualInput="false"
    :placeholder="placeholder"
    :dateFormat="dateFormat"
    :showIcon="true"
    iconDisplay="input"
    class="base-datepicker w-full"
    @update:modelValue="$emit('update:modelValue', $event)"
  />
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue?: Date | Date[] | null
  selectionMode?: 'single' | 'multiple' | 'range'
  placeholder?: string
  dateFormat?: string
}>(), {
  selectionMode: 'single',
  dateFormat: 'd MM yy',
  placeholder: 'Выберите дату',
})

defineEmits<{ 'update:modelValue': [value: Date | Date[] | null] }>()
</script>

<style scoped>
.base-datepicker { width: 100%; }

/* === Input field — same as BaseInput === */
:deep(.p-datepicker-input),
:deep(.p-inputtext) {
  width: 100% !important;
  height: 42px !important;
  padding: 0 42px 0 14px !important;
  border-radius: 11px !important;
  background: var(--p-surface-100) !important;
  border: 1.5px solid var(--p-surface-300) !important;
  font-size: 14.5px !important;
  font-family: inherit !important;
  color: var(--p-surface-900) !important;
}
[data-theme="dark"] :deep(.p-datepicker-input),
[data-theme="dark"] :deep(.p-inputtext) {
  background: color-mix(in srgb, var(--p-surface-200) 50%, transparent) !important;
}
:deep(.p-datepicker-input:focus),
:deep(.p-inputtext:focus) {
  border-color: var(--p-primary-color) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 18%, transparent) !important;
}

/* Icon — vertically centered on the right */
:deep(.p-inputicon),
:deep(.p-datepicker-input-icon-container),
:deep(.p-datepicker-input-icon) {
  position: absolute !important;
  top: 50% !important;
  right: 14px !important;
  transform: translateY(-50%) !important;
  margin: 0 !important;
  color: var(--p-surface-400) !important;
  pointer-events: none;
  font-size: 14px;
}
:deep(.p-iconfield),
:deep(.p-datepicker-input-wrapper) {
  position: relative;
  display: block;
  width: 100%;
}
</style>

<!-- Global calendar panel styles — must be unscoped because the panel teleports to body -->
<style>
.p-datepicker-panel {
  border-radius: 16px !important;
  padding: 16px 18px !important;
  background: var(--p-surface-0) !important;
  border: 1px solid var(--divider) !important;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.18) !important;
  min-width: 320px;
}
[data-theme="dark"] .p-datepicker-panel {
  background: var(--p-surface-50) !important;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.45) !important;
}

.p-datepicker-header {
  padding: 0 0 14px !important;
  border-bottom: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
}
.p-datepicker-title {
  display: flex;
  gap: 6px;
  font-weight: 700 !important;
  color: var(--p-surface-900);
  text-transform: capitalize;
  font-size: 14px !important;
}
.p-datepicker-prev-button,
.p-datepicker-next-button {
  width: 30px !important;
  height: 30px !important;
  border-radius: 8px !important;
  color: var(--p-surface-500) !important;
  background: transparent !important;
  border: none !important;
}
.p-datepicker-prev-button:hover,
.p-datepicker-next-button:hover {
  background: var(--p-surface-100) !important;
  color: var(--p-surface-800) !important;
}

.p-datepicker-calendar {
  border-collapse: separate !important;
  border-spacing: 0 !important;
}
.p-datepicker-weekday-cell { padding: 0 !important; }
.p-datepicker-weekday {
  font-size: 11px !important;
  font-weight: 700 !important;
  color: var(--p-surface-400) !important;
  text-transform: uppercase;
  padding: 6px 0 8px !important;
  text-align: center;
}

.p-datepicker-day-cell {
  padding: 0 !important;
  background: transparent;
}
.p-datepicker-day {
  width: 38px !important;
  height: 36px !important;
  font-size: 13px !important;
  color: var(--p-surface-700) !important;
  background: transparent !important;
  border-radius: 8px !important;
  transition: background 0.1s, color 0.1s;
  font-weight: 500 !important;
  margin: 1px auto;
}
.p-datepicker-day:not(.p-disabled):hover {
  background: var(--p-surface-100) !important;
}
.p-datepicker-day.p-datepicker-other-month {
  color: var(--p-surface-400) !important;
  opacity: 0.45;
}
.p-datepicker-day.p-datepicker-today:not(.p-datepicker-day-selected) {
  color: var(--p-primary-color) !important;
  font-weight: 700 !important;
  box-shadow: inset 0 0 0 1.5px var(--p-primary-color);
}

/* Range middle */
.p-datepicker-day-cell.p-datepicker-day-selected-range {
  background: color-mix(in srgb, var(--p-primary-color) 16%, transparent) !important;
}
.p-datepicker-day-cell.p-datepicker-day-selected-range .p-datepicker-day {
  color: var(--p-primary-color) !important;
  background: transparent !important;
  font-weight: 600 !important;
  border-radius: 0 !important;
  margin: 0 !important;
  width: 100% !important;
}

/* Start & end */
.p-datepicker-day.p-datepicker-day-selected {
  background: var(--p-primary-color) !important;
  color: #fff !important;
  font-weight: 700 !important;
  border-radius: 8px !important;
}
</style>
