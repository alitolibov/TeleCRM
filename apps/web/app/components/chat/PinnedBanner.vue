<script setup lang="ts">
import type { ChatMessage } from '~/stores/chats'

const props = defineProps<{
  /** All currently pinned messages, oldest first (latest at the end) — matches
   *  the chats.pinned_message_ids stack on the server. */
  pins: ChatMessage[]
  /** Controlled cursor — parent (index.vue) bumps it on click + on natural
   *  scroll so the banner stays in sync with the reading position. */
  cursor: number
}>()

const emit = defineEmits<{
  (e: 'update:cursor', value: number): void
  (e: 'jumpTo', messageId: string): void
  (e: 'unpin', messageId: string): void
}>()

const current = computed(() => props.pins[props.cursor])
const hasMany = computed(() => props.pins.length > 1)
/** Array is sorted newest-message-first by the API, so cursor 0 is "today's"
 *  pin and the counter reads naturally: 1 of N at the freshest, N of N at
 *  the oldest. */
const counterCurrent = computed(() => props.cursor + 1)

/** Step to the next older pinned message. After the oldest, wraps back to
 *  the freshest — matches Telegram's click cycle. */
function advance() {
  if (!hasMany.value) return
  emit('update:cursor', (props.cursor + 1) % props.pins.length)
}

/** Body click — first jump to the current pin, then advance to the next
 *  older one so the next click steps through. */
function onBodyClick() {
  if (!current.value) return
  emit('jumpTo', current.value.id)
  if (hasMany.value) advance()
}

/** Compact preview text — same logic as the chat-list preview but shorter. */
const preview = computed(() => {
  const c = current.value?.content
  if (!c) return 'Сообщение'
  if (c.type === 'text') return c.text
  if (c.type === 'photo')     return '📷 Фото' + (c.caption ? `: ${c.caption}` : '')
  if (c.type === 'voice')     return '🎤 Голосовое сообщение'
  if (c.type === 'video')     return '🎥 Видео' + (c.caption ? `: ${c.caption}` : '')
  if (c.type === 'videoNote') return '⭕ Видеосообщение'
  if (c.type === 'document')  return '📎 ' + (c.fileName || 'Файл')
  if (c.type === 'sticker')   return (c.emoji || '🎁') + ' Стикер'
  return 'Сообщение'
})
</script>

<template>
  <div v-if="current" class="pinned-banner">
    <div class="pinned-bar">
      <span v-for="(_, i) in pins" :key="i" class="pinned-bar-seg" :class="{ active: i === cursor }" />
    </div>
    <div class="pinned-icon"><i class="pi pi-bookmark" /></div>
    <div class="pinned-body" @click="onBodyClick">
      <div class="pinned-title">
        Закреплено
        <span v-if="hasMany" class="pinned-counter">{{ counterCurrent }} из {{ pins.length }}</span>
      </div>
      <div class="pinned-preview">{{ preview }}</div>
    </div>
    <button
      class="pinned-close"
      type="button"
      title="Открепить"
      @click.stop="emit('unpin', current.id)"
    >
      <i class="pi pi-times" />
    </button>
  </div>
</template>

<style scoped>
.pinned-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-200);
  flex-shrink: 0;
}
/* Stacked segment bars on the left — like Telegram's pin indicator. Each
   segment matches one pin; the active one is fully opaque. */
.pinned-bar {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  justify-content: stretch;
  gap: 2px;
  width: 3px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
}
.pinned-bar-seg {
  flex: 1;
  background: var(--p-primary-color);
  opacity: 0.35;
  border-radius: 2px;
  transition: opacity 0.1s;
}
.pinned-bar-seg.active { opacity: 1; }
.pinned-bar:hover .pinned-bar-seg { opacity: 0.6; }
.pinned-bar:hover .pinned-bar-seg.active { opacity: 1; }

.pinned-icon {
  width: 28px; height: 28px;
  border-radius: 9999px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
  flex-shrink: 0;
}
.pinned-icon i { font-size: 12px; }
.pinned-body {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.pinned-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--p-primary-color);
  letter-spacing: 0.02em;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}
.pinned-counter {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--p-surface-400);
  letter-spacing: 0;
}
.pinned-preview {
  font-size: 12.5px;
  color: var(--p-surface-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}
.pinned-close {
  width: 26px; height: 26px;
  border-radius: 9999px;
  display: flex; align-items: center; justify-content: center;
  color: var(--p-surface-400);
  flex-shrink: 0;
}
.pinned-close:hover {
  background: var(--p-surface-100);
  color: var(--p-surface-700);
}
</style>
