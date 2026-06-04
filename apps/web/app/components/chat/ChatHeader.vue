<script setup lang="ts">
import type { Chat } from '~/stores/chats'
import { avatarColor, initials } from '~/utils/format'

defineProps<{ chat: Chat }>()
defineEmits<{
  (e: 'assign'): void
  (e: 'close'): void
  (e: 'reopen'): void
  (e: 'transfer'): void
}>()

function statusLabel(s: string) {
  return s === 'new' ? 'Новый' : s === 'active' ? 'В работе' : 'Закрыт'
}
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
      <!-- CRM-saved contacts hide the @nick/id sub-line — the team-chosen
           name is the identity now, the TG handle is just noise. -->
      <div v-if="!chat.hasCrmContact" class="text-xs text-surface-400 mono mt-0.5 truncate">
        {{ chat.client.username ? `@${chat.client.username}` : `id: ${chat.client.telegramId}` }}
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
</style>
