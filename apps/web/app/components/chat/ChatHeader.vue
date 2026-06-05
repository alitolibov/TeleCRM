<script setup lang="ts">
import type { Chat } from '~/stores/chats'
import { avatarColor, initials } from '~/utils/format'
import { formatLastSeen, bucketStatusLabel, chatActionLabel } from '~/utils/presence'

const props = defineProps<{ chat: Chat }>()
defineEmits<{
  (e: 'assign'): void
  (e: 'close'): void
  (e: 'reopen'): void
  (e: 'transfer'): void
}>()

function statusLabel(s: string) {
  return s === 'new' ? 'Новый' : s === 'active' ? 'В работе' : 'Закрыт'
}

// Header subline = priority chain: typing action wins over online state,
// which wins over precise last-seen, which wins over the bucket label, and
// the @nick/id is the very last fallback (only visible when no presence
// data and the client isn't a saved contact). This 1:1 mirrors Telegram.
const store = useChatsStore()
const liveAction = computed(() => store.actionFor(props.chat.id))

const subline = computed<{ text: string; kind: 'typing' | 'online' | 'last-seen' | 'handle' | 'empty' }>(() => {
  const c = props.chat.client

  if (liveAction.value) {
    const label = chatActionLabel(liveAction.value)
    if (label) return { text: `${label}…`, kind: 'typing' }
  }
  if (c.onlineStatus === 'online') {
    return { text: 'в сети', kind: 'online' }
  }
  if (c.onlineStatus === 'offline' && c.lastSeenAt) {
    return { text: formatLastSeen(c.lastSeenAt), kind: 'last-seen' }
  }
  if (c.onlineStatus && c.onlineStatus !== 'empty') {
    const text = bucketStatusLabel(c.onlineStatus)
    if (text) return { text, kind: 'last-seen' }
  }
  // No status known yet — fall through to the @nick / id legacy line, but
  // only for non-contacts (CRM contacts get the team-chosen name only).
  if (!props.chat.hasCrmContact) {
    return {
      text: c.username ? `@${c.username}` : `id: ${c.telegramId}`,
      kind: 'handle',
    }
  }
  return { text: '', kind: 'empty' }
})
</script>

<template>
  <header class="flex items-center gap-3 px-5 py-3 bg-surface-0 chat-area-header flex-shrink-0">
    <div class="avatar-circle md" :class="avatarColor(chat.client.telegramId)">
      {{ initials(chat.client.firstName, chat.client.lastName) }}
    </div>
    <div class="flex-1 min-w-0">
      <div class="font-bold text-[15px] text-surface-900 leading-tight truncate">
        {{ chat.client.firstName }} {{ chat.client.lastName ?? '' }}
      </div>
      <!-- Subline priority: typing > "в сети" > last-seen > @nick / id.
           CRM-saved contacts also hide the @nick fallback — the team-chosen
           name is the identity now. -->
      <div
        v-if="subline.text"
        class="text-xs mt-0.5 truncate header-subline"
        :class="{
          'header-subline-typing': subline.kind === 'typing',
          'header-subline-online': subline.kind === 'online',
          'header-subline-handle': subline.kind === 'handle',
        }"
      >
        <template v-if="subline.kind === 'typing'">
          <span class="header-typing-text">{{ subline.text.replace(/…$/, '') }}</span>
          <span class="header-typing-dots">
            <i></i><i></i><i></i>
          </span>
        </template>
        <template v-else>{{ subline.text }}</template>
      </div>
    </div>
    <div class="flex items-center gap-2 flex-shrink-0">
      <span class="header-status" :class="`header-status-${chat.status}`">
        {{ statusLabel(chat.status) }}
      </span>
      <button
        v-if="chat.status === 'new'"
        class="chat-act chat-act-primary"
        @click="$emit('assign')"
      >
        <i class="pi pi-bookmark" /> Взять в работу
      </button>
      <button
        v-if="chat.status !== 'closed'"
        class="chat-act chat-act-ghost"
        @click="$emit('transfer')"
      >
        <i class="pi pi-send" /> Передать
      </button>
      <button
        v-if="chat.status === 'active'"
        class="chat-act chat-act-ghost"
        @click="$emit('close')"
      >
        <i class="pi pi-check" /> Закрыть
      </button>
      <button
        v-if="chat.status === 'closed'"
        class="chat-act chat-act-primary"
        @click="$emit('reopen')"
      >
        <i class="pi pi-refresh" /> Взять обратно
      </button>
    </div>
  </header>
</template>

<style scoped>
.chat-act {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 14px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition: background-color 0.15s, color 0.15s, filter 0.15s;
}
.chat-act > i { font-size: 13px; }

.chat-act-ghost {
  background: var(--p-surface-100);
  color: var(--p-surface-700);
}
.chat-act-ghost:hover { background: var(--p-surface-200); color: var(--p-surface-900); }

.chat-act-primary {
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, #fff);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--p-primary-color) 30%, transparent);
}
.chat-act-primary:hover { filter: brightness(1.07); }

/* Header subline tones, mirroring Telegram's accent palette */
.header-subline { color: var(--p-surface-400); }
.header-subline-online { color: #10b981; font-weight: 500; }
.header-subline-typing { color: var(--p-primary-color); font-weight: 500; }
.header-subline-handle { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.header-typing-text { margin-right: 2px; }
.header-typing-dots {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  vertical-align: baseline;
}
.header-typing-dots i {
  width: 3px;
  height: 3px;
  border-radius: 9999px;
  background: currentColor;
  display: inline-block;
  animation: typing-bounce 1.1s infinite ease-in-out both;
}
.header-typing-dots i:nth-child(2) { animation-delay: 0.18s; }
.header-typing-dots i:nth-child(3) { animation-delay: 0.36s; }
@keyframes typing-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
  40%           { transform: translateY(-2px); opacity: 1; }
}
</style>
