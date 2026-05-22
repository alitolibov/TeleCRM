<script setup lang="ts">
import type { Chat } from '~/stores/chats'
import { avatarColor, initials, formatTime } from '~/utils/format'

const props = defineProps<{
  chats: Chat[]
  activeId: string | null
  loading: boolean
}>()

defineEmits<{
  (e: 'select', id: string): void
}>()

const search = ref('')
const activeFilter = ref('all')

const filters = [
  { label: 'Все',      value: 'all' },
  { label: 'Новые',    value: 'new' },
  { label: 'В работе', value: 'active' },
  { label: 'Закрытые', value: 'closed' },
]

const filteredChats = computed(() => {
  let list = props.chats
  if (activeFilter.value !== 'all') {
    list = list.filter(c => c.status === activeFilter.value)
  }
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    list = list.filter(c =>
      c.client.firstName.toLowerCase().includes(q) ||
      (c.client.lastName ?? '').toLowerCase().includes(q) ||
      (c.client.username ?? '').toLowerCase().includes(q),
    )
  }
  return list
})

function filterCount(val: string) {
  if (val === 'all') return props.chats.length
  return props.chats.filter(c => c.status === val).length
}

function chatPreview(chat: Chat): string {
  const last = chat.lastMessage
  if (!last) return ''
  const prefix = last.senderType === 'manager' ? 'Вы: ' : ''
  const c = last.content
  if (!c) return prefix + '...'
  switch (c.type) {
    case 'text':      return prefix + c.text
    case 'photo':     return prefix + '📷 Фото' + (c.caption ? `: ${c.caption}` : '')
    case 'voice':     return prefix + '🎤 Голосовое сообщение'
    case 'video':     return prefix + '🎥 Видео' + (c.caption ? `: ${c.caption}` : '')
    case 'videoNote': return prefix + '⭕ Видеосообщение'
    case 'document':  return prefix + '📎 ' + (c.fileName || 'Файл')
    case 'sticker':   return prefix + (c.emoji || '🎁') + ' Стикер'
    default:          return prefix + 'Сообщение'
  }
}

function statusLabel(s: string) {
  return s === 'new' ? 'Новый' : s === 'active' ? 'В работе' : 'Закрыт'
}
</script>

<template>
  <aside class="w-[340px] flex-shrink-0 flex flex-col bg-surface-0 chat-aside">
    <header class="p-3 flex flex-col gap-2.5 chat-list-toolbar">
      <!-- Search -->
      <div class="search-wrap">
        <i class="pi pi-search search-icon" />
        <input
          v-model="search"
          type="text"
          placeholder="Поиск..."
          class="search-input"
        />
        <button v-if="search" class="search-clear" type="button" @click="search = ''">
          <i class="pi pi-times" />
        </button>
      </div>

      <!-- Filter pills -->
      <div class="filter-bar">
        <button
          v-for="f in filters" :key="f.value"
          class="filter-pill"
          :class="{ 'filter-pill-active': activeFilter === f.value }"
          type="button"
          @click="activeFilter = f.value"
        >
          <span>{{ f.label }}</span>
          <span
            v-if="filterCount(f.value) > 0"
            class="filter-count"
            :class="{ 'filter-count-active': activeFilter === f.value }"
          >{{ filterCount(f.value) }}</span>
        </button>
      </div>
    </header>

    <!-- List -->
    <div class="flex-1 overflow-y-auto px-1.5 py-2">
      <div v-if="loading" class="flex flex-col gap-1.5 px-1.5">
        <Skeleton v-for="i in 6" :key="i" height="64px" borderRadius="12px" />
      </div>
      <div v-else-if="filteredChats.length === 0"
        class="flex flex-col items-center justify-center h-48 text-sm text-surface-400 gap-3 px-6 text-center">
        <i class="pi pi-comments text-4xl opacity-30" />
        <div>{{ search ? 'Ничего не найдено' : activeFilter === 'all' ? 'Здесь пока пусто' : 'Нет чатов' }}</div>
      </div>

      <button
        v-for="chat in filteredChats" :key="chat.id"
        class="chat-row"
        :class="{ 'chat-row-active': activeId === chat.id }"
        @click="$emit('select', chat.id)"
      >
        <div class="avatar-circle md" :class="avatarColor(chat.client.telegramId)">
          {{ initials(chat.client.firstName, chat.client.lastName) }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-baseline gap-2">
            <span class="font-semibold text-[14.5px] text-surface-900 truncate">
              {{ chat.client.firstName }} {{ chat.client.lastName ?? '' }}
            </span>
            <span class="text-[11.5px] text-surface-400 font-medium flex-shrink-0">
              {{ formatTime(chat.lastMessageAt) }}
            </span>
          </div>
          <div class="flex justify-between items-center mt-1 gap-2">
            <span class="text-[13px] text-surface-500 truncate flex-1 min-w-0">
              {{ chatPreview(chat) }}
            </span>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <span
                v-if="chat.status !== 'active'"
                class="status-dot"
                :class="`status-dot-${chat.status}`"
                :title="statusLabel(chat.status)"
              />
              <span v-if="chat.unreadCount > 0" class="unread-badge">{{ chat.unreadCount }}</span>
            </div>
          </div>
        </div>
      </button>
    </div>
  </aside>
</template>
