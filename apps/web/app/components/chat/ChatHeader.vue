<script setup lang="ts">
import type { Chat } from '~/stores/chats'
import { avatarColor, initials } from '~/utils/format'

defineProps<{ chat: Chat }>()
defineEmits<{
  (e: 'assign'): void
  (e: 'close'): void
  (e: 'reopen'): void
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
      <div class="text-xs text-surface-400 mono mt-0.5 truncate">
        {{ chat.client.username ? `@${chat.client.username}` : `id: ${chat.client.telegramId}` }}
      </div>
    </div>
    <div class="flex items-center gap-2 flex-shrink-0">
      <span class="header-status" :class="`header-status-${chat.status}`">
        {{ statusLabel(chat.status) }}
      </span>
      <Button
        v-if="chat.status === 'new'"
        label="Взять в работу"
        icon="pi pi-bookmark"
        size="small"
        severity="primary"
        outlined
        @click="$emit('assign')"
      />
      <Button
        v-if="chat.status === 'active'"
        label="Закрыть"
        icon="pi pi-check"
        size="small"
        severity="secondary"
        outlined
        @click="$emit('close')"
      />
      <Button
        v-if="chat.status === 'closed'"
        label="Взять обратно"
        icon="pi pi-refresh"
        size="small"
        severity="primary"
        outlined
        @click="$emit('reopen')"
      />
    </div>
  </header>
</template>
