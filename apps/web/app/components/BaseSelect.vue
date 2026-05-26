<script setup lang="ts">
interface Option { label: string; value: string }

const props = defineProps<{
  modelValue: string
  options: Option[]
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const open = ref(false)
const wrap = ref<HTMLElement>()

const selectedLabel = computed(() =>
  props.options.find(o => o.value === props.modelValue)?.label ?? props.placeholder ?? 'Выберите…',
)

function select(v: string) {
  emit('update:modelValue', v)
  open.value = false
}

function onClickOutside(e: MouseEvent) {
  const t = e.target as Node | null
  if (!t || !(t as any).isConnected) return
  if (open.value && wrap.value && !wrap.value.contains(t)) open.value = false
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="wrap" class="bsel">
    <button type="button" class="bsel-trigger" :class="{ 'bsel-open': open }" @click="open = !open">
      <span class="bsel-label">{{ selectedLabel }}</span>
      <i class="pi pi-chevron-down bsel-chevron" :class="{ 'rotate-180': open }" />
    </button>

    <Transition name="bsel-pop">
      <div v-if="open" class="bsel-menu">
        <button
          v-for="o in options" :key="o.value"
          type="button"
          class="bsel-item"
          :class="{ 'bsel-item-active': o.value === modelValue }"
          @click="select(o.value)"
        >
          <span class="flex-1 text-left truncate">{{ o.label }}</span>
          <i v-if="o.value === modelValue" class="pi pi-check bsel-check" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.bsel { position: relative; }
.bsel-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 42px;
  padding: 0 12px;
  background: var(--p-surface-100);
  border: 1.5px solid var(--p-surface-300);
  border-radius: 11px;
  font-size: 13.5px;
  color: var(--p-surface-800);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.bsel-trigger:hover { border-color: var(--p-surface-400); }
.bsel-open {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}
.bsel-label { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bsel-chevron { font-size: 10px; opacity: 0.6; transition: transform 0.18s; flex-shrink: 0; }

.bsel-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 40;
  max-height: 280px;
  overflow-y: auto;
  padding: 5px;
  border-radius: 12px;
  background: var(--p-surface-0);
  border: 1px solid var(--divider);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}
.bsel-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--p-surface-800);
  transition: background 0.12s;
}
.bsel-item:hover { background: var(--p-surface-100); }
.bsel-item-active { color: var(--p-primary-color); font-weight: 600; }
.bsel-check { color: var(--p-primary-color); font-size: 12px; flex-shrink: 0; }

.bsel-pop-enter-active, .bsel-pop-leave-active { transition: opacity 0.14s, transform 0.14s; }
.bsel-pop-enter-from, .bsel-pop-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
