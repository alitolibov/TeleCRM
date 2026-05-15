<template>
  <div class="flex h-full overflow-hidden">
    <!-- ===== Chat List ===== -->
    <div class="w-[340px] flex-shrink-0 flex flex-col bg-surface-0 border-r border-surface-200">
      <!-- Toolbar -->
      <div class="p-3.5 border-b border-surface-200 flex flex-col gap-2.5">
        <IconField iconPosition="left" class="w-full">
          <InputIcon class="pi pi-search" />
          <InputText v-model="search" placeholder="Поиск..." class="w-full text-sm" />
        </IconField>
        <!-- Filter tabs -->
        <div class="flex gap-1 p-1 bg-surface-100 rounded-xl">
          <button
            v-for="f in filters" :key="f.value"
            class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
            :class="activeFilter === f.value
              ? 'bg-surface-0 text-surface-900 shadow-sm'
              : 'text-surface-500 hover:text-surface-700'"
            @click="activeFilter = f.value"
          >
            {{ f.label }}
            <span class="text-[10.5px] px-1.5 py-0.5 rounded-full font-bold"
              :class="activeFilter === f.value ? 'bg-primary-50 text-primary-600' : 'bg-surface-200 text-surface-500'">
              {{ filterCount(f.value) }}
            </span>
          </button>
        </div>
      </div>

      <!-- List -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="flex flex-col gap-2 p-3">
          <Skeleton v-for="i in 5" :key="i" height="64px" borderRadius="10px" />
        </div>
        <div v-else-if="filteredChats.length === 0"
          class="flex flex-col items-center justify-center h-40 text-sm text-surface-400 gap-2">
          <i class="pi pi-comments text-3xl opacity-30" />
          Чатов нет
        </div>
        <div
          v-for="chat in filteredChats" :key="chat.id"
          class="chat-row"
          :class="{ 'chat-row-active': activeChat?.id === chat.id }"
          @click="handleOpenChat(chat.id)"
        >
          <div class="avatar-circle" :class="avatarColor(chat.client.telegramId)">
            {{ initials(chat.client.firstName, chat.client.lastName) }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex justify-between items-center mb-0.5 gap-2">
              <span class="font-semibold text-sm text-surface-900 truncate">
                {{ chat.client.firstName }} {{ chat.client.lastName ?? '' }}
              </span>
              <span class="text-[11px] text-surface-400 flex-shrink-0 font-medium">
                {{ formatTime(chat.lastMessageAt) }}
              </span>
            </div>
            <div class="text-[12.5px] text-surface-400 mb-1.5 truncate">
              {{ chat.client.username ? `@${chat.client.username}` : `ID: ${chat.client.telegramId}` }}
            </div>
            <div class="flex items-center gap-1.5">
              <Tag :value="statusLabel(chat.status)" :severity="statusSeverity(chat.status)" class="text-[10px]" />
              <Badge v-if="chat.unreadCount > 0" :value="chat.unreadCount" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Chat Area ===== -->
    <div v-if="activeChat" class="flex-1 flex flex-col min-w-0 bg-surface-50">
      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-3 bg-surface-0 border-b border-surface-200 flex-shrink-0">
        <div class="avatar-circle md" :class="avatarColor(activeChat.client.telegramId)">
          {{ initials(activeChat.client.firstName, activeChat.client.lastName) }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-[15px] text-surface-900">
            {{ activeChat.client.firstName }} {{ activeChat.client.lastName ?? '' }}
          </div>
          <div class="text-xs text-surface-400 mono">
            {{ activeChat.client.username ? `@${activeChat.client.username}` : `Telegram ID: ${activeChat.client.telegramId}` }}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Tag :value="statusLabel(activeChat.status)" :severity="statusSeverity(activeChat.status)" />
          <Button
            v-if="activeChat.status !== 'closed'"
            label="Взять"
            size="small"
            severity="secondary"
            @click="handleAssign"
          />
          <Button
            v-if="activeChat.status !== 'closed'"
            label="Закрыть"
            size="small"
            severity="secondary"
            @click="handleClose"
          />
        </div>
      </div>

      <!-- Messages -->
      <div class="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-2.5" ref="messagesEl" @scroll="onMessagesScroll">
        <!-- Sentinel: triggers loading older when visible -->
        <div ref="topSentinel" class="flex items-center justify-center py-2">
          <div v-if="loadingOlder" class="text-xs text-surface-400 flex items-center gap-2">
            <i class="pi pi-spin pi-spinner text-xs" />
            Загружаю историю...
          </div>
          <div v-else-if="historyExhausted" class="text-[11px] text-surface-300">
            начало диалога
          </div>
        </div>
        <div v-if="messages.length === 0 && !loadingOlder"
          class="flex-1 flex items-center justify-center text-sm text-surface-400">
          Нет сообщений
        </div>
        <div
          v-for="msg in messages" :key="msg.id"
          class="flex gap-2 items-end max-w-[70%]"
          :class="msg.senderType === 'manager' ? 'self-end flex-row-reverse' : 'self-start'"
        >
          <div v-if="msg.senderType !== 'manager'"
            class="avatar-circle sm" :class="avatarColor(activeChat.client.telegramId)">
            {{ initials(activeChat.client.firstName) }}
          </div>
          <div class="bubble" :class="msg.senderType === 'manager' ? 'bubble-out' : 'bubble-in'">
            <template v-if="msg.content?.type === 'text'">{{ msg.content.text }}</template>
            <template v-else-if="msg.content?.type === 'photo'">
              <span class="flex items-center gap-1.5">📷 Фото{{ msg.content.caption ? `: ${msg.content.caption}` : '' }}</span>
            </template>
            <template v-else-if="msg.content?.type === 'voice'">
              <span class="flex items-center gap-1.5">🎤 Голосовое · {{ msg.content.duration }}с</span>
            </template>
            <template v-else-if="msg.content?.type === 'document'">
              <span class="flex items-center gap-1.5">📎 {{ msg.content.fileName }}</span>
            </template>
            <template v-else-if="msg.content?.type === 'video'">
              <span>🎥 Видео</span>
            </template>
            <template v-else>
              <span class="text-xs opacity-60 italic">Неподдерживаемый тип</span>
            </template>
            <div class="text-[10.5px] mt-1 opacity-60 text-right">{{ formatTime(msg.createdAt) }}</div>
          </div>
        </div>
      </div>

      <!-- Composer -->
      <div class="px-4 py-3 bg-surface-0 border-t border-surface-200 flex gap-2.5 items-end flex-shrink-0">
        <div class="flex-1 bg-surface-100 border border-surface-200 rounded-xl px-3 py-2 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-200 transition-all">
          <Textarea
            v-model="text"
            placeholder="Напишите сообщение..."
            :rows="1"
            autoResize
            class="w-full bg-transparent border-none outline-none text-sm text-surface-900 resize-none min-h-[22px] max-h-[120px]"
            @keydown.enter.exact.prevent="handleSend"
          />
          <div class="text-[11px] text-surface-400 mt-1">
            <kbd class="px-1 py-0.5 bg-surface-200 rounded text-[10px] border border-surface-300">Enter</kbd> отправить ·
            <kbd class="px-1 py-0.5 bg-surface-200 rounded text-[10px] border border-surface-300">Shift+Enter</kbd> перенос
          </div>
        </div>
        <Button
          icon="pi pi-send"
          rounded
          :disabled="!text.trim()"
          @click="handleSend"
          class="flex-shrink-0 h-11 w-11"
        />
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="flex-1 flex flex-col items-center justify-center gap-3 text-surface-400">
      <i class="pi pi-comments text-5xl opacity-20" />
      <p class="text-sm">Выберите чат</p>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { chats, activeChat, messages, loading, openChat, loadOlder, sendMessage, assignChat, closeChat, setupRealtime } = useChats()
const { getToken } = useAuth()
const { connect } = useSocket()

const search = ref('')
const activeFilter = ref('all')
const text = ref('')
const messagesEl = ref<HTMLElement>()
const loadingOlder = ref(false)
const historyExhausted = ref(false)

const filters = [
  { label: 'Все', value: 'all' },
  { label: 'Новые', value: 'new' },
  { label: 'В работе', value: 'active' },
  { label: 'Закрыты', value: 'closed' },
]

const filteredChats = computed(() => {
  let list = chats.value
  if (activeFilter.value !== 'all') list = list.filter(c => c.status === activeFilter.value)
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
  if (val === 'all') return chats.value.length
  return chats.value.filter(c => c.status === val).length
}

// Detect scroll near top → load older messages. Preserve scroll position
// after prepend so the view stays anchored to what the user was reading.
async function onMessagesScroll() {
  const el = messagesEl.value
  if (!el || loadingOlder.value || historyExhausted.value || !activeChat.value) return
  if (el.scrollTop > 80) return

  loadingOlder.value = true
  const prevHeight = el.scrollHeight
  try {
    const added = await loadOlder(activeChat.value.id)
    if (added === 0) {
      historyExhausted.value = true
    } else {
      await nextTick()
      // Keep the viewport on the same content after prepending
      el.scrollTop = el.scrollHeight - prevHeight
    }
  } finally {
    loadingOlder.value = false
  }
}

async function handleOpenChat(id: string) {
  historyExhausted.value = false
  await openChat(id)
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

async function handleSend() {
  if (!text.value.trim()) return
  await sendMessage(text.value.trim())
  text.value = ''
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

async function handleAssign() {
  if (!activeChat.value) return
  await assignChat(activeChat.value.id)
}

async function handleClose() {
  if (!activeChat.value) return
  await closeChat(activeChat.value.id)
}

// Helpers
const avatarColors = ['orange', 'blue', 'green', 'purple', 'pink', 'teal']
function avatarColor(id: number) { return avatarColors[id % avatarColors.length] }
function initials(first: string, last?: string | null) {
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?'
}
function formatTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}
function statusLabel(s: string) {
  return s === 'new' ? 'Новый' : s === 'active' ? 'В работе' : 'Закрыт'
}
function statusSeverity(s: string) {
  return s === 'new' ? 'info' : s === 'active' ? 'success' : 'secondary'
}

onMounted(async () => {
  const token = getToken()
  if (token) connect(token)
  setupRealtime()
})
</script>

<style scoped>
.chat-row {
  @apply flex gap-2.5 px-3.5 py-3 border-b border-surface-100 cursor-pointer transition-colors relative;
}
.chat-row:hover { @apply bg-surface-50; }
.chat-row-active {
  @apply bg-primary-50;
}
.chat-row-active::before {
  content: '';
  @apply absolute left-0 top-0 bottom-0 w-0.5 bg-primary-600;
}

.avatar-circle {
  @apply w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-[13px] flex-shrink-0;
}
.avatar-circle.sm { @apply w-7 h-7 text-[11px]; }
.avatar-circle.md { @apply w-9 h-9 text-[13px]; }
.avatar-circle.orange { background: linear-gradient(135deg, #f97316, #c2410c); }
.avatar-circle.blue   { background: linear-gradient(135deg, #3b82f6, #1d4ed8); }
.avatar-circle.green  { background: linear-gradient(135deg, #10b981, #059669); }
.avatar-circle.purple { background: linear-gradient(135deg, #8b5cf6, #6d28d9); }
.avatar-circle.pink   { background: linear-gradient(135deg, #ec4899, #be185d); }
.avatar-circle.teal   { background: linear-gradient(135deg, #14b8a6, #0f766e); }

.bubble {
  @apply px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words max-w-full;
}
.bubble-in {
  background: var(--bubble-in);
  color: var(--bubble-in-text);
  @apply rounded-bl-sm;
}
.bubble-out {
  background: var(--bubble-out);
  @apply text-white rounded-br-sm;
}
</style>
