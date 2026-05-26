<script setup lang="ts">
import { formatTime } from '~/utils/format'

const store = useNotificationsStore()
const open = ref(false)
const wrap = ref<HTMLElement>()

const emit = defineEmits<{ (e: 'open-chat', chatId: string): void }>()

function toggle() {
  open.value = !open.value
  if (open.value) store.markAllRead()
}

function onItemClick(n: { id: string; chatId?: string }) {
  store.markRead(n.id)
  open.value = false
  if (n.chatId) emit('open-chat', n.chatId)
}

function iconFor(type: string) {
  if (type === 'escalation') return 'pi pi-exclamation-triangle'
  if (type === 'system') return 'pi pi-wifi'
  return 'pi pi-send'
}

function onClickOutside(e: MouseEvent) {
  const target = e.target as Node
  // Ignore clicks on nodes already detached from the DOM (e.g. a badge removed
  // by a re-render during the same click) — contains() would falsely report "outside".
  if (!target || !(target as any).isConnected) return
  if (open.value && wrap.value && !wrap.value.contains(target)) open.value = false
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="wrap" class="notif-bell">
    <button class="notif-trigger" type="button" @click.stop="toggle">
      <i class="pi pi-bell" />
      <span v-if="store.unreadCount > 0" class="notif-dot">{{ store.unreadCount > 9 ? '9+' : store.unreadCount }}</span>
    </button>

    <Transition name="notif-pop">
      <div v-if="open" class="notif-panel">
        <header class="notif-head">
          <span class="font-bold text-[14px] text-surface-900">Уведомления</span>
          <button v-if="store.items.length" class="notif-clear" type="button" @click="store.clear()">
            Очистить
          </button>
        </header>

        <div v-if="store.items.length === 0" class="notif-empty">
          <i class="pi pi-inbox text-2xl opacity-30" />
          <span>Пока пусто</span>
        </div>

        <ul v-else class="notif-list">
          <li
            v-for="n in store.items" :key="n.id"
            class="notif-item"
            :class="{ 'notif-item-clickable': n.chatId }"
            @click="onItemClick(n)"
          >
            <span class="notif-icon" :class="n.type === 'escalation' ? (n.level && n.level >= 2 ? 'notif-icon-danger' : 'notif-icon-warn') : n.type === 'system' ? 'notif-icon-warn' : 'notif-icon-info'">
              <i :class="iconFor(n.type)" />
            </span>
            <div class="flex-1 min-w-0">
              <div class="notif-title">{{ n.title }}</div>
              <div class="notif-body">{{ n.body }}</div>
              <div class="notif-time">{{ formatTime(n.createdAt) }}</div>
            </div>
            <i v-if="n.chatId" class="pi pi-chevron-right notif-go" />
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.notif-bell { position: relative; }
.notif-trigger {
  position: relative;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--p-surface-500);
  transition: background 0.15s, color 0.15s;
}
.notif-trigger:hover { background: var(--p-surface-100); color: var(--p-surface-800); }
.notif-dot {
  position: absolute;
  top: 4px; right: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 9999px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

.notif-panel {
  position: absolute;
  top: calc(100% + 8px);
  /* Sidebar is narrow — open the panel rightward over the main area so it
     doesn't get clipped off the left edge of the viewport. */
  left: 0;
  z-index: 50;
  width: 320px;
  max-height: 440px;
  display: flex;
  flex-direction: column;
  background: var(--p-surface-0);
  border: 1px solid var(--divider);
  border-radius: 14px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}
.notif-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--divider);
}
.notif-clear {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-primary-color);
}
.notif-clear:hover { text-decoration: underline; }
.notif-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 0;
  color: var(--p-surface-400);
  font-size: 13px;
}
.notif-list { overflow-y: auto; }
.notif-item {
  display: flex;
  gap: 11px;
  padding: 11px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--divider) 60%, transparent);
  transition: background 0.12s;
}
.notif-item-clickable { cursor: pointer; }
.notif-item-clickable:hover { background: var(--p-surface-100); }
.notif-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}
.notif-icon-warn   { background: rgba(245, 158, 11, 0.14); color: #d97706; }
.notif-icon-danger { background: rgba(239, 68, 68, 0.14); color: #dc2626; }
.notif-icon-info   { background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color); }
.notif-title { font-size: 13.5px; font-weight: 600; color: var(--p-surface-900); }
.notif-body {
  font-size: 12.5px;
  color: var(--p-surface-500);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.notif-time { font-size: 11px; color: var(--p-surface-400); margin-top: 3px; }
.notif-go { color: var(--p-surface-300); font-size: 11px; align-self: center; flex-shrink: 0; }

.notif-pop-enter-active, .notif-pop-leave-active { transition: opacity 0.15s, transform 0.15s; }
.notif-pop-enter-from, .notif-pop-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
