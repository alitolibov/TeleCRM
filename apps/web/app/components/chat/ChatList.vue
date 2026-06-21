<script setup lang="ts">
import type { Chat } from '~/stores/chats'
import type { ChatListFilters } from '~/composables/useChats'
import { FAVORITES_CHAT_ID } from '~/composables/useFavorites'
import BaseDatePicker from '~/components/BaseDatePicker.vue'
import { avatarColor, initials, formatTime } from '~/utils/format'

const props = defineProps<{
  chats: Chat[]
  activeId: string | null
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  filters: ChatListFilters       // reactive — mutated in place to drive server queries
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'loadMore'): void
}>()

const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

// Directory of all employees — resolves senderId → name in previews, and
// populates the admin "responsible manager" filter.
const usersStore = useUsersStore()

const statusOptions = [
  { label: 'Все',      value: '' },
  { label: 'Новые',    value: 'new' },
  { label: 'В работе', value: 'active' },
  { label: 'Закрытые', value: 'closed' },
] as const

// Whether any filter/search is active — drives the empty-state copy.
const hasActiveFilter = computed(() =>
  !!(props.filters.status || props.filters.assignedTo || props.filters.dateFrom || props.filters.dateTo || props.filters.q.trim()),
)

// Date range (by last message, spec 5.2) — collapsible to save sidebar space.
const showDateFilter = ref(false)
const dateRange = ref<Date[] | null>(null)
watch(dateRange, (r) => {
  if (r?.[0] && r[1]) {
    const from = new Date(r[0]); from.setHours(0, 0, 0, 0)
    const to = new Date(r[1]); to.setHours(23, 59, 59, 999)
    props.filters.dateFrom = from.toISOString()
    props.filters.dateTo = to.toISOString()
  } else {
    props.filters.dateFrom = ''
    props.filters.dateTo = ''
  }
})

// === Custom "responsible manager" dropdown (admin only) ===
const managerMenuOpen = ref(false)
const managerWrap = ref<HTMLElement>()

const selectedManagerLabel = computed(() => {
  const v = props.filters.assignedTo
  if (v === '') return 'Все менеджеры'
  if (v === 'unassigned') return 'Без владельца'
  return usersStore.all.find(u => u.id === v)?.firstName ?? 'Менеджер'
})

function selectManager(value: string) {
  props.filters.assignedTo = value
  managerMenuOpen.value = false
}

function onClickOutside(e: MouseEvent) {
  if (managerMenuOpen.value && managerWrap.value && !managerWrap.value.contains(e.target as Node)) {
    managerMenuOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))

/**
 * Build the chat-list preview prefix:
 *  - client message → no prefix
 *  - own outgoing  → "Вы: "
 *  - other manager → "{firstName}: "
 *  - sender unknown → "Менеджер: "
 */
function senderPrefix(last: NonNullable<Chat['lastMessage']>): string {
  if (last.senderType !== 'manager') return ''
  if (last.senderId && user.value && last.senderId === user.value.id) return 'Вы: '
  if (last.senderId) {
    const sender = usersStore.all.find(u => u.id === last.senderId)
    if (sender) return `${sender.firstName}: `
  }
  return 'Менеджер: '
}

function chatPreview(chat: Chat): string {
  const last = chat.lastMessage
  if (!last) return ''
  const prefix = senderPrefix(last)
  const c = last.content
  const body =
    !c ? '...'
    : c.type === 'text'      ? c.text
    : c.type === 'photo'     ? '📷 Фото' + (c.caption ? `: ${c.caption}` : '')
    : c.type === 'voice'     ? '🎤 Голосовое сообщение'
    : c.type === 'video'     ? '🎥 Видео' + (c.caption ? `: ${c.caption}` : '')
    : c.type === 'videoNote' ? '⭕ Видеосообщение'
    : c.type === 'document'  ? '📎 ' + (c.fileName || 'Файл')
    : c.type === 'sticker'   ? (c.emoji || '🎁') + ' Стикер'
    : 'Сообщение'
  const full = prefix + body
  // Spec 5.1 — last-message preview truncated to 80 chars.
  return full.length > 80 ? full.slice(0, 80) + '…' : full
}

function statusLabel(s: string) {
  return s === 'new' ? 'Новый' : s === 'active' ? 'В работе' : 'Закрыт'
}

// Infinite scroll — ask the parent for the next page when nearing the bottom.
function onListScroll(e: Event) {
  if (!props.hasMore || props.loadingMore) return
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) emit('loadMore')
}

function resetFilters() {
  props.filters.status = ''
  props.filters.assignedTo = ''
  props.filters.q = ''
  dateRange.value = null
  showDateFilter.value = false
}
</script>

<template>
  <aside class="w-[340px] flex-shrink-0 flex flex-col bg-surface-0 chat-aside">
    <header class="p-3 flex flex-col gap-2.5 chat-list-toolbar">
      <!-- Search -->
      <div class="search-wrap">
        <i class="pi pi-search search-icon" />
        <input
          v-model="filters.q"
          type="text"
          placeholder="Поиск по имени, @username, тексту..."
          class="search-input"
        />
        <button v-if="filters.q" class="search-clear" type="button" @click="filters.q = ''">
          <i class="pi pi-times" />
        </button>
      </div>

      <!-- Status pills -->
      <div class="filter-bar">
        <button
          v-for="f in statusOptions" :key="f.value"
          class="filter-pill"
          :class="{ 'filter-pill-active': filters.status === f.value }"
          type="button"
          @click="filters.status = f.value"
        >
          <span>{{ f.label }}</span>
        </button>
      </div>

      <!-- Responsible-manager filter (admin only) — custom dropdown with avatars -->
      <div v-if="isAdmin" ref="managerWrap" class="mgr-filter">
        <button
          class="mgr-trigger"
          :class="{ 'mgr-trigger-active': filters.assignedTo !== '' }"
          type="button"
          @click="managerMenuOpen = !managerMenuOpen"
        >
          <i class="pi pi-users mgr-trigger-icon" />
          <span class="mgr-trigger-label">{{ selectedManagerLabel }}</span>
          <i class="pi pi-chevron-down mgr-trigger-chevron" :class="{ 'rotate-180': managerMenuOpen }" />
        </button>

        <Transition name="mgr-pop">
          <div v-if="managerMenuOpen" class="mgr-menu">
            <button class="mgr-item" type="button" @click="selectManager('')">
              <span class="mgr-item-icon all"><i class="pi pi-th-large" /></span>
              <span class="mgr-item-name">Все менеджеры</span>
              <i v-if="filters.assignedTo === ''" class="pi pi-check mgr-item-check" />
            </button>
            <button class="mgr-item" type="button" @click="selectManager('unassigned')">
              <span class="mgr-item-icon none"><i class="pi pi-inbox" /></span>
              <span class="mgr-item-name">Без владельца</span>
              <i v-if="filters.assignedTo === 'unassigned'" class="pi pi-check mgr-item-check" />
            </button>
            <div class="mgr-divider" />
            <button
              v-for="u in usersStore.all" :key="u.id"
              class="mgr-item" type="button"
              @click="selectManager(u.id)"
            >
              <span class="avatar-circle sm" :class="avatarColor(u.id.charCodeAt(0) + u.id.charCodeAt(1))">
                {{ initials(u.firstName, u.lastName) }}
              </span>
              <span class="mgr-item-name">{{ u.firstName }} {{ u.lastName ?? '' }}</span>
              <span class="mgr-presence" :class="u.status === 'online' ? 'mgr-presence-on' : 'mgr-presence-off'" />
              <i v-if="filters.assignedTo === u.id" class="pi pi-check mgr-item-check" />
            </button>
          </div>
        </Transition>
      </div>

      <!-- Date filter (by last message, spec 5.2) — collapsible -->
      <button
        class="cl-date-toggle"
        :class="{ 'cl-date-toggle-active': showDateFilter || filters.dateFrom }"
        type="button"
        @click="showDateFilter = !showDateFilter"
      >
        <i class="pi pi-calendar" />
        <span>{{ filters.dateFrom ? 'Период выбран' : 'Фильтр по дате' }}</span>
        <i class="pi pi-chevron-down text-[10px] ml-auto" :class="{ 'rotate-180': showDateFilter }" />
      </button>
      <BaseDatePicker
        v-if="showDateFilter"
        v-model="dateRange"
        selectionMode="range"
        placeholder="Дата последнего сообщения"
        dateFormat="d MM yy"
      />

      <button
        v-if="hasActiveFilter"
        class="text-[12px] text-primary-600 font-semibold self-start hover:underline"
        type="button"
        @click="resetFilters"
      >
        Сбросить фильтры
      </button>
    </header>

    <!-- List -->
    <div class="flex-1 overflow-y-auto px-1.5 py-2" @scroll="onListScroll">
      <!-- Personal "Saved Messages" — always pinned at top, ignores filters.
           Exception: hide while a search query is typed so name-/text-matches
           are the only results. Owner / status / date filters are about the
           CRM workspace and don't apply to the user's private notes. -->
      <button
        v-if="!filters.q.trim()"
        class="chat-row chat-row-favorites"
        :class="{ 'chat-row-active': activeId === FAVORITES_CHAT_ID }"
        @click="$emit('select', FAVORITES_CHAT_ID)"
      >
        <div class="avatar-circle md favorites-avatar">
          <i class="pi pi-bookmark-fill" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-baseline gap-2">
            <span class="font-semibold text-[14.5px] text-surface-900 truncate">Избранное</span>
          </div>
          <div class="text-[12.5px] text-surface-400 truncate mt-0.5">
            Личные заметки и пересланные сообщения
          </div>
        </div>
      </button>

      <div v-if="loading" class="flex flex-col gap-1.5 px-1.5">
        <Skeleton v-for="i in 6" :key="i" height="64px" borderRadius="12px" />
      </div>
      <div v-else-if="chats.length === 0"
        class="flex flex-col items-center justify-center h-48 text-sm text-surface-400 gap-3 px-6 text-center">
        <i class="pi pi-comments text-4xl opacity-30" />
        <div>{{ hasActiveFilter ? 'Ничего не найдено' : 'Здесь пока пусто' }}</div>
      </div>

      <template v-else>
        <button
          v-for="chat in chats" :key="chat.id"
          v-memo="[
            chat.id === activeId,
            chat.lastMessage?.id,
            chat.lastMessageAt,
            chat.unreadCount,
            chat.status,
            chat.assignedTo,
            chat.client.firstName,
            chat.client.lastName,
            chat.client.onlineStatus,
          ]"
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
                <span v-if="chat.unreadCount > 0" class="unread-badge">{{ chat.unreadCount }}</span>
              </div>
            </div>

            <!-- Status tag (everyone) + admin-only ownership tag. -->
            <div class="chat-row-tag-line">
              <span class="chat-row-status" :class="`chat-row-status-${chat.status}`">
                <span class="chat-row-status-dot" />
                {{ statusLabel(chat.status) }}
              </span>
              <template v-if="isAdmin">
                <span v-if="chat.assignedUser" class="chat-row-tag">
                  <i class="pi pi-user text-[9px]" />
                  {{ chat.assignedUser.firstName }}
                </span>
                <span v-else-if="chat.status === 'new'" class="chat-row-tag chat-row-tag-queued">
                  <i class="pi pi-inbox text-[9px]" />
                  в очереди
                </span>
                <span v-else class="chat-row-tag chat-row-tag-warning">
                  <i class="pi pi-exclamation-triangle text-[9px]" />
                  без владельца
                </span>
              </template>
            </div>
          </div>
        </button>

        <!-- Load-more spinner -->
        <div v-if="loadingMore" class="flex justify-center py-3 text-surface-400">
          <i class="pi pi-spin pi-spinner" />
        </div>
      </template>
    </div>
  </aside>
</template>
