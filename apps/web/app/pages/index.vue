<template>
  <div class="flex h-full overflow-hidden bg-surface-50">
    <!-- ============ Chat List ============ -->
    <aside class="w-[340px] flex-shrink-0 flex flex-col bg-surface-0 chat-aside">
      <!-- Toolbar -->
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
          <button
            v-if="search"
            class="search-clear"
            type="button"
            @click="search = ''"
          >
            <i class="pi pi-times" />
          </button>
        </div>

        <!-- Filter pills (horizontal scroll if needed) -->
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
          :class="{ 'chat-row-active': activeChat?.id === chat.id }"
          @click="handleOpenChat(chat.id)"
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

    <!-- ============ Chat Area ============ -->
    <main v-if="activeChat" class="flex-1 flex flex-col min-w-0 chat-area-bg">
      <!-- Header -->
      <header class="flex items-center gap-3 px-5 py-3 bg-surface-0 chat-area-header flex-shrink-0">
        <div class="avatar-circle md" :class="avatarColor(activeChat.client.telegramId)">
          {{ initials(activeChat.client.firstName, activeChat.client.lastName) }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-[15px] text-surface-900 leading-tight truncate">
            {{ activeChat.client.firstName }} {{ activeChat.client.lastName ?? '' }}
          </div>
          <div class="text-xs text-surface-400 mono mt-0.5 truncate">
            {{ activeChat.client.username ? `@${activeChat.client.username}` : `id: ${activeChat.client.telegramId}` }}
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="header-status" :class="`header-status-${activeChat.status}`">
            {{ statusLabel(activeChat.status) }}
          </span>
          <!-- Show "Take" only for new chats; "Close" only for active/new -->
          <Button
            v-if="activeChat.status === 'new'"
            label="Взять в работу"
            icon="pi pi-bookmark"
            size="small"
            severity="primary"
            outlined
            @click="handleAssign"
          />
          <Button
            v-if="activeChat.status === 'active'"
            label="Закрыть"
            icon="pi pi-check"
            size="small"
            severity="secondary"
            outlined
            @click="handleClose"
          />
          <Button
            v-if="activeChat.status === 'closed'"
            label="Взять обратно"
            icon="pi pi-refresh"
            size="small"
            severity="primary"
            outlined
            @click="handleReopen"
          />
        </div>
      </header>

      <!-- Messages -->
      <div
        class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-0.5"
        ref="messagesEl"
        @scroll="onMessagesScroll"
      >
        <div ref="topSentinel" class="flex items-center justify-center py-2">
          <div v-if="loadingOlder" class="text-xs text-surface-400 flex items-center gap-2">
            <i class="pi pi-spin pi-spinner text-xs" /> Загружаю историю...
          </div>
          <div v-else-if="historyExhausted && messages.length > 0" class="text-[11px] text-surface-300">
            — начало диалога —
          </div>
        </div>

        <div v-if="messages.length === 0 && !loadingOlder"
          class="flex-1 flex flex-col items-center justify-center text-sm text-surface-400 gap-2">
          <i class="pi pi-comment text-3xl opacity-30" />
          Нет сообщений
        </div>

        <template v-for="(msg, idx) in messages" :key="msg.id">
          <div v-if="needsDaySeparator(idx)" class="day-sep">
            <span>{{ formatDay(msg.createdAt) }}</span>
          </div>

          <div
            class="message-row"
            :class="[
              msg.senderType === 'manager' ? 'self-end' : 'self-start',
              startsGroup(idx) ? 'mt-2.5' : 'mt-0.5',
            ]"
          >
            <div
              class="bubble"
              :class="[
                msg.senderType === 'manager' ? 'bubble-out' : 'bubble-in',
                bubbleShape(idx),
                isMediaOnly(msg) ? 'bubble-media' : '',
              ]"
            >
              <template v-if="msg.content?.type === 'text'">
                <div class="bubble-text">{{ msg.content.text }}<span class="bubble-meta-inline">{{ formatMessageTime(msg.createdAt) }}</span></div>
              </template>

              <template v-else-if="msg.content?.type === 'photo'">
                <a :href="fileUrl(msg.content.fileId)" target="_blank" rel="noopener" class="media-wrap">
                  <img
                    :src="fileUrl(msg.content.fileId)"
                    :alt="msg.content.caption || 'photo'"
                    loading="lazy"
                    class="media-img"
                  />
                  <span class="bubble-meta-overlay">{{ formatMessageTime(msg.createdAt) }}</span>
                </a>
                <div v-if="msg.content.caption" class="bubble-text mt-1.5">
                  {{ msg.content.caption }}<span class="bubble-meta-inline">{{ formatMessageTime(msg.createdAt) }}</span>
                </div>
              </template>

              <template v-else-if="msg.content?.type === 'voice'">
                <VoicePlayer
                  :src="fileUrl(msg.content.fileId)"
                  :duration="msg.content.duration"
                  :outgoing="msg.senderType === 'manager'"
                  :time="formatMessageTime(msg.createdAt)"
                />
              </template>

              <template v-else-if="msg.content?.type === 'video'">
                <div class="media-wrap">
                  <video
                    controls
                    preload="metadata"
                    :src="fileUrl(msg.content.fileId)"
                    class="media-img"
                  />
                  <span class="bubble-meta-overlay">{{ formatMessageTime(msg.createdAt) }}</span>
                </div>
                <div v-if="msg.content.caption" class="bubble-text mt-1.5">
                  {{ msg.content.caption }}<span class="bubble-meta-inline">{{ formatMessageTime(msg.createdAt) }}</span>
                </div>
              </template>

              <template v-else-if="msg.content?.type === 'videoNote'">
                <div class="video-note" @click="toggleVideoNote">
                  <video
                    :src="fileUrl(msg.content.fileId)"
                    playsinline
                    loop
                    muted
                    autoplay
                    preload="metadata"
                    class="video-note-player"
                  />
                  <span class="video-note-meta">
                    <i class="pi pi-volume-up text-[10px]" />
                    {{ formatVideoDuration(msg.content.duration) }}
                  </span>
                  <span class="video-note-time">{{ formatMessageTime(msg.createdAt) }}</span>
                </div>
              </template>

              <template v-else-if="msg.content?.type === 'document'">
                <a
                  :href="fileUrl(msg.content.fileId)"
                  :download="msg.content.fileName"
                  target="_blank"
                  class="doc-attachment"
                >
                  <span class="doc-icon"><i class="pi pi-file" /></span>
                  <span class="flex flex-col min-w-0">
                    <span class="text-[13.5px] font-semibold truncate">{{ msg.content.fileName }}</span>
                    <span class="text-[11.5px] opacity-70">{{ formatBytes(msg.content.size) }}</span>
                  </span>
                </a>
                <div v-if="msg.content.caption" class="bubble-text mt-1.5">
                  {{ msg.content.caption }}<span class="bubble-meta-inline">{{ formatMessageTime(msg.createdAt) }}</span>
                </div>
                <span v-if="!msg.content.caption" class="bubble-meta">{{ formatMessageTime(msg.createdAt) }}</span>
              </template>

              <template v-else-if="msg.content?.type === 'sticker'">
                <div class="sticker-display">
                  <span class="sticker-emoji">{{ msg.content.emoji || '🎁' }}</span>
                  <span class="sticker-time">{{ formatMessageTime(msg.createdAt) }}</span>
                </div>
              </template>

              <template v-else>
                <div class="unsupported">
                  <i class="pi pi-info-circle" />
                  <span>Сообщение не поддерживается</span>
                  <span class="bubble-meta-inline">{{ formatMessageTime(msg.createdAt) }}</span>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- Scroll-to-bottom floating button -->
        <Transition name="fade">
          <button
            v-if="showScrollDown"
            class="scroll-down-btn"
            type="button"
            @click="scrollToBottom(true)"
          >
            <i class="pi pi-chevron-down" />
            <span v-if="newSinceUnscrolled > 0" class="scroll-down-badge">{{ newSinceUnscrolled }}</span>
          </button>
        </Transition>
      </div>

      <!-- Composer -->
      <div class="composer">
        <button
          class="composer-btn"
          v-tooltip.top="'Прикрепить файл'"
          :disabled="uploading"
          @click="fileInput?.click()"
        >
          <i :class="uploading ? 'pi pi-spin pi-spinner' : 'pi pi-paperclip'" />
        </button>
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept="image/*,application/pdf,video/*,audio/*,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt"
          @change="onFileSelected"
        />
        <div class="composer-input">
          <Textarea
            v-model="text"
            placeholder="Сообщение..."
            :rows="1"
            autoResize
            unstyled
            class="composer-textarea"
            @keydown.enter.exact.prevent="handleSend"
          />
        </div>
        <button
          class="composer-send"
          :class="{ 'composer-send-active': text.trim().length > 0 }"
          :disabled="!text.trim()"
          @click="handleSend"
        >
          <i class="pi pi-send" />
        </button>
      </div>
    </main>

    <!-- Empty chat state -->
    <main v-else class="flex-1 flex flex-col items-center justify-center gap-4 chat-area-bg text-surface-400">
      <div class="w-20 h-20 rounded-full bg-surface-100 flex items-center justify-center">
        <i class="pi pi-comments text-3xl opacity-50" />
      </div>
      <p class="text-sm">Выберите чат, чтобы начать переписку</p>
    </main>

    <!-- ============ Client Info Sidebar ============ -->
    <aside v-if="activeChat" class="client-panel">
      <!-- Avatar + name -->
      <div class="flex flex-col items-center text-center pt-7 pb-5 px-5">
        <div class="avatar-circle lg" :class="avatarColor(activeChat.client.telegramId)">
          {{ initials(activeChat.client.firstName, activeChat.client.lastName) }}
        </div>
        <div class="mt-3 text-[17px] font-bold text-surface-900">
          {{ activeChat.client.firstName }} {{ activeChat.client.lastName ?? '' }}
        </div>
        <div class="mt-0.5 text-[12.5px] text-surface-400 mono">
          {{ activeChat.client.username ? `@${activeChat.client.username}` : `id: ${activeChat.client.telegramId}` }}
        </div>
      </div>

      <div class="info-divider" />

      <!-- Info block -->
      <div class="px-5 py-4">
        <div class="info-title">Информация</div>
        <dl class="space-y-2.5 mt-3">
          <div class="flex justify-between items-center text-[13px]">
            <dt class="text-surface-500">Telegram ID</dt>
            <dd class="font-semibold mono">{{ activeChat.client.telegramId }}</dd>
          </div>
          <div v-if="clientInfo" class="flex justify-between items-center text-[13px]">
            <dt class="text-surface-500">Первое обращение</dt>
            <dd class="font-semibold">{{ formatDate(clientInfo.firstContactAt) }}</dd>
          </div>
          <div v-if="clientInfo?.assignedUser" class="flex justify-between items-center text-[13px]">
            <dt class="text-surface-500">Менеджер</dt>
            <dd class="font-semibold flex items-center gap-1.5">
              <span class="avatar-circle xs purple">{{ clientInfo.assignedUser.firstName?.[0]?.toUpperCase() ?? '?' }}</span>
              {{ clientInfo.assignedUser.firstName }}
            </dd>
          </div>
        </dl>
      </div>

      <div v-if="clientInfo?.latestStatus || clientInfo?.currentChatResult" class="info-divider" />

      <!-- Client status -->
      <div v-if="clientInfo?.latestStatus || clientInfo?.currentChatResult" class="px-5 py-4">
        <div class="info-title">Статус клиента</div>
        <div class="mt-3">
          <span class="status-pill" :class="`status-pill-${clientInfo.currentChatResult?.clientStatus ?? clientInfo.latestStatus}`">
            <i class="pi pi-clock text-[10px]" />
            {{ statusLabels[(clientInfo.currentChatResult?.clientStatus ?? clientInfo.latestStatus) as ClientStatus] }}
          </span>
          <p v-if="clientInfo.currentChatResult?.comment" class="mt-3 text-[13px] text-surface-600 leading-relaxed">
            {{ clientInfo.currentChatResult.comment }}
          </p>
          <div v-if="clientInfo.currentChatResult?.flight || clientInfo.currentChatResult?.dates" class="mt-3 space-y-1 text-[12.5px]">
            <div v-if="clientInfo.currentChatResult?.flight" class="flex gap-2">
              <span class="text-surface-400">Рейс:</span>
              <span class="font-medium">{{ clientInfo.currentChatResult.flight }}</span>
            </div>
            <div v-if="clientInfo.currentChatResult?.dates" class="flex gap-2">
              <span class="text-surface-400">Даты:</span>
              <span class="font-medium">{{ clientInfo.currentChatResult.dates }}</span>
            </div>
            <div v-if="clientInfo.currentChatResult?.amount" class="flex gap-2">
              <span class="text-surface-400">Сумма:</span>
              <span class="font-medium">${{ clientInfo.currentChatResult.amount }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="clientInfo?.timeline?.length" class="info-divider" />

      <!-- History timeline -->
      <div v-if="clientInfo?.timeline?.length" class="px-5 py-4">
        <div class="info-title">История</div>
        <ul class="mt-3 space-y-3.5">
          <li v-for="(t, idx) in clientInfo.timeline" :key="idx" class="flex gap-3">
            <span
              class="history-dot"
              :class="t.type === 'closed' ? `status-dot-${t.clientStatus}` :
                      t.type === 'reopened' ? 'bg-primary-400' : 'bg-surface-300'"
            />
            <div class="flex-1 min-w-0">
              <template v-if="t.type === 'closed'">
                <div class="text-[13.5px] font-semibold">
                  {{ statusLabels[t.clientStatus] }}{{ t.flight ? ` · ${t.flight}` : '' }}
                </div>
                <div class="text-[11.5px] text-surface-400 mt-0.5">
                  {{ formatDate(t.date) }}<span v-if="t.amount"> · ${{ t.amount }}</span>
                </div>
              </template>
              <template v-else-if="t.type === 'reopened'">
                <div class="text-[13.5px] font-semibold">Возобновлён</div>
                <div class="text-[11.5px] text-surface-400 mt-0.5">{{ formatDate(t.date) }}</div>
              </template>
              <template v-else>
                <div class="text-[13.5px] font-semibold">Первое обращение</div>
                <div class="text-[11.5px] text-surface-400 mt-0.5">{{ formatDate(t.date) }}</div>
              </template>
            </div>
          </li>
        </ul>
      </div>
    </aside>

    <!-- "Take in work" confirmation -->
    <Dialog
      v-model:visible="takeDialog.open"
      modal
      :showHeader="false"
      :closable="false"
      :draggable="false"
      :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 420px;' } }"
      class="take-dialog"
    >
      <div class="p-2">
        <div class="flex flex-col items-center text-center gap-4 px-4 pt-6 pb-2">
          <div class="take-icon">
            <i class="pi pi-bookmark text-2xl" />
          </div>
          <div class="flex flex-col gap-1.5">
            <h3 class="text-[18px] font-bold text-surface-900">Новый чат</h3>
            <p class="text-[14px] text-surface-500 leading-snug max-w-[300px]">
              Взять чат в работу и отправить сообщение?
            </p>
          </div>
        </div>
        <div class="flex gap-2 mt-5 px-1">
          <Button
            label="Отмена"
            severity="secondary"
            outlined
            class="flex-1 !rounded-xl"
            @click="cancelTake"
          />
          <Button
            label="Да, взять"
            class="flex-1 !rounded-xl !font-semibold"
            @click="acceptTake"
          />
        </div>
      </div>
    </Dialog>

    <!-- ============ Close chat modal ============ -->
    <Dialog
      v-model:visible="closeDialog.open"
      modal
      :showHeader="false"
      :draggable="false"
      :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 540px; width: 92vw;' } }"
      class="close-dialog"
    >
      <div class="close-dialog-body">
        <header class="close-head">
          <div>
            <h3 class="text-[19px] font-extrabold text-surface-900">Закрытие чата</h3>
            <p class="text-[13px] text-surface-500 mt-1">
              Зафиксируйте результат общения с клиентом
            </p>
          </div>
          <button class="close-x" @click="closeDialog.open = false">
            <i class="pi pi-times" />
          </button>
        </header>

        <div class="close-body">
          <!-- Status radios -->
          <div>
            <div class="field-label">
              Статус клиента <span class="text-red-500">*</span>
            </div>
            <div class="status-grid">
              <label
                v-for="s in clientStatuses" :key="s.value"
                class="status-radio"
                :class="{ 'status-radio-active': closeDialog.status === s.value }"
              >
                <input
                  type="radio"
                  :value="s.value"
                  v-model="closeDialog.status"
                  class="sr-only"
                />
                <span class="status-radio-mark" :class="{ 'status-radio-mark-active': closeDialog.status === s.value }">
                  <span v-if="closeDialog.status === s.value" class="status-radio-dot" />
                </span>
                <span class="text-[14px] font-medium">{{ s.label }}</span>
              </label>
            </div>
          </div>

          <!-- Flight + amount -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="field-label">Какой рейс</div>
              <div class="route-pair">
                <BaseInput v-model="closeDialog.flightFrom" placeholder="Откуда" />
                <i class="pi pi-arrow-right route-arrow" />
                <BaseInput v-model="closeDialog.flightTo" placeholder="Куда" />
              </div>
            </div>
            <div>
              <div class="field-label">Сумма</div>
              <BaseInput
                v-model="closeDialog.amount"
                placeholder="0"
                inputmode="decimal"
                :sanitize="onlyDecimal"
                prefix="$"
              />
            </div>
          </div>

          <!-- Dates -->
          <div>
            <div class="field-label">На какие даты</div>
            <BaseDatePicker
              v-model="closeDialog.dateRange"
              selectionMode="range"
              placeholder="Выберите даты"
              dateFormat="d MM yy"
            />
          </div>

          <!-- Comment -->
          <div>
            <div class="field-label">Комментарий менеджера</div>
            <BaseTextarea
              v-model="closeDialog.comment"
              :rows="3"
              placeholder="Подробности о клиенте, договорённости, напоминания..."
            />
          </div>
        </div>

        <footer class="close-footer">
          <BaseButton
            variant="text"
            :disabled="closeDialog.saving"
            @click="closeDialog.open = false"
          >Отмена</BaseButton>
          <BaseButton
            variant="primary"
            :icon="closeDialog.saving ? '' : 'pi pi-check'"
            :loading="closeDialog.saving"
            :disabled="!closeDialog.status"
            @click="confirmClose"
          >Закрыть чат</BaseButton>
        </footer>
      </div>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import VoicePlayer from '~/components/VoicePlayer.vue'

definePageMeta({ middleware: 'auth' })

const { chats, activeChat, messages, loading, openChat, loadOlder, sendMessage, assignChat, closeChat, reopenChat, loadClientInfo, setupRealtime } = useChats()
type ClientStatus = 'thinking' | 'consulting' | 'waiting_price' | 'booked' | 'bought'
type ClientInfoData = Awaited<ReturnType<typeof loadClientInfo>>

const clientInfo = ref<ClientInfoData | null>(null)
const closeDialog = ref({
  open: false,
  status: '' as ClientStatus | '',
  flightFrom: '',
  flightTo: '',
  dateRange: null as Date[] | null,
  amount: '',
  comment: '',
  saving: false,
})

function onlyDecimal(raw: string): string {
  // Keep digits and a single decimal point
  return raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
}

function formatDateRange(range: Date[] | null): string {
  if (!range || !range[0]) return ''
  const fmt = (d: Date) => d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
  const year = range[0].getFullYear()
  if (!range[1] || range[0].toDateString() === range[1].toDateString()) {
    return `${fmt(range[0])} ${year}`
  }
  return `${fmt(range[0])} – ${fmt(range[1])} ${year}`
}

const clientStatuses: { value: ClientStatus; label: string }[] = [
  { value: 'thinking',     label: 'Думает' },
  { value: 'consulting',   label: 'Пошёл посоветоваться' },
  { value: 'waiting_price', label: 'Ждёт снижения цены' },
  { value: 'booked',       label: 'Забронировал' },
  { value: 'bought',       label: 'Купил' },
]
const statusLabels: Record<ClientStatus, string> = {
  thinking: 'Думает',
  consulting: 'Пошёл посоветоваться',
  waiting_price: 'Ждёт снижения цены',
  booked: 'Забронировал',
  bought: 'Купил',
}
const { getToken } = useAuth()
const { connect } = useSocket()
const config = useRuntimeConfig()

function fileUrl(fileId: number) {
  return `${config.public.apiUrl}/files/${fileId}`
}

function formatBytes(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const search = ref('')
const activeFilter = ref('all')
const text = ref('')
const messagesEl = ref<HTMLElement>()
const loadingOlder = ref(false)
const historyExhausted = ref(false)
const showScrollDown = ref(false)
const newSinceUnscrolled = ref(0)
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const takeDialog = ref<{ open: boolean; accept: (() => Promise<void>) | null }>({ open: false, accept: null })

function askTakeChat(onAccept: () => Promise<void>) {
  takeDialog.value = { open: true, accept: onAccept }
}
function cancelTake() {
  takeDialog.value = { open: false, accept: null }
}
async function acceptTake() {
  const cb = takeDialog.value.accept
  takeDialog.value = { open: false, accept: null }
  if (cb) await cb()
}

const filters = [
  { label: 'Все', value: 'all' },
  { label: 'Новые', value: 'new' },
  { label: 'В работе', value: 'active' },
  { label: 'Закрытые', value: 'closed' },
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

function chatPreview(chat: any): string {
  const last = chat.lastMessage
  if (!last) return ''
  const prefix = last.senderType === 'manager' ? 'Вы: ' : ''
  const c = last.content
  if (!c) return prefix + '...'
  switch (c.type) {
    case 'text': return prefix + c.text
    case 'photo': return prefix + '📷 Фото' + (c.caption ? `: ${c.caption}` : '')
    case 'voice': return prefix + '🎤 Голосовое сообщение'
    case 'video': return prefix + '🎥 Видео' + (c.caption ? `: ${c.caption}` : '')
    case 'videoNote': return prefix + '⭕ Видеосообщение'
    case 'document': return prefix + '📎 ' + (c.fileName || 'Файл')
    case 'sticker': return prefix + (c.emoji || '🎁') + ' Стикер'
    default: return prefix + 'Сообщение'
  }
}

// "Media only" bubble = no padding (image/video fills the bubble entirely)
function isMediaOnly(msg: any): boolean {
  const t = msg?.content?.type
  return (t === 'photo' || t === 'video') && !msg.content.caption
}

async function onMessagesScroll() {
  const el = messagesEl.value
  if (!el) return

  // Track distance from bottom for the scroll-down FAB
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  showScrollDown.value = distanceFromBottom > 200
  if (distanceFromBottom < 80) newSinceUnscrolled.value = 0

  // Trigger backfill near the top
  if (loadingOlder.value || historyExhausted.value || !activeChat.value) return
  if (el.scrollTop > 80) return

  loadingOlder.value = true
  const prevHeight = el.scrollHeight
  try {
    const added = await loadOlder(activeChat.value.id)
    if (added === 0) {
      historyExhausted.value = true
    } else {
      await nextTick()
      el.scrollTop = el.scrollHeight - prevHeight
    }
  } finally {
    loadingOlder.value = false
  }
}

function scrollToBottom(smooth = false) {
  const el = messagesEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  newSinceUnscrolled.value = 0
}

// Auto-follow when messages arrive — if user is near the bottom, scroll;
// otherwise show the floating "down" button with a counter.
watch(
  () => messages.value.length,
  async (newLen, oldLen) => {
    if (newLen <= (oldLen ?? 0)) return
    await nextTick()
    const el = messagesEl.value
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 200) {
      scrollToBottom()
    } else {
      newSinceUnscrolled.value += newLen - (oldLen ?? 0)
    }
  },
)

async function handleOpenChat(id: string) {
  historyExhausted.value = false
  newSinceUnscrolled.value = 0
  await openChat(id)
  await nextTick()
  scrollToBottom()
}

async function handleSend() {
  const body = text.value.trim()
  if (!body || !activeChat.value) return

  if (activeChat.value.status === 'new') {
    askTakeChat(async () => {
      try { await assignChat(activeChat.value!.id) } catch { return }
      await doSend(body)
    })
    return
  }

  await doSend(body)
}

async function doSend(body: string) {
  await sendMessage(body)
  text.value = ''
  await nextTick()
  scrollToBottom()
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !activeChat.value) return

  // For 'new' chats, take it first then upload
  if (activeChat.value.status === 'new') {
    askTakeChat(async () => {
      try { await assignChat(activeChat.value!.id) } catch { return }
      await doUpload(file)
    })
    return
  }
  await doUpload(file)
}

async function doUpload(file: File) {
  if (!activeChat.value) return
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    if (text.value.trim()) form.append('caption', text.value.trim())
    await useApi().api<{ queued: boolean }>(
      `/chats/${activeChat.value.id}/upload`,
      { method: 'POST', body: form },
    )
    text.value = ''
  } catch (err) {
    console.error('upload failed', err)
  } finally {
    uploading.value = false
  }
}

async function handleAssign() {
  if (!activeChat.value) return
  await assignChat(activeChat.value.id)
}

function handleClose() {
  if (!activeChat.value) return
  closeDialog.value = {
    open: true,
    status: '',
    flightFrom: '',
    flightTo: '',
    dateRange: null,
    amount: '',
    comment: '',
    saving: false,
  }
}

async function handleReopen() {
  if (!activeChat.value) return
  await reopenChat(activeChat.value.id)
  await refreshClientInfo(activeChat.value.id)
}

async function confirmClose() {
  const d = closeDialog.value
  if (!d.status || !activeChat.value) return
  d.saving = true
  try {
    await closeChat({
      chatId: activeChat.value.id,
      data: {
        status: d.status as ClientStatus,
        flightFrom: d.flightFrom || undefined,
        flightTo: d.flightTo || undefined,
        dates: formatDateRange(d.dateRange) || undefined,
        amount: d.amount ? Number(d.amount) : undefined,
        comment: d.comment || undefined,
      },
    })
    closeDialog.value.open = false
    if (activeChat.value) await refreshClientInfo(activeChat.value.id)
  } finally {
    closeDialog.value.saving = false
  }
}

async function refreshClientInfo(chatId: string) {
  try {
    clientInfo.value = await loadClientInfo(chatId)
  } catch {
    clientInfo.value = null
  }
}

// Reload client info each time the active chat changes
watch(() => activeChat.value?.id, (id) => {
  if (id) refreshClientInfo(id)
  else clientInfo.value = null
})

// Also re-pull when the chat's status flips (close/reopen) so the
// sidebar timeline updates without a manual refresh.
watch(() => activeChat.value?.status, () => {
  if (activeChat.value?.id) refreshClientInfo(activeChat.value.id)
})

// === Message grouping ===
function startsGroup(idx: number): boolean {
  if (idx === 0) return true
  const prev = messages.value[idx - 1]
  const cur = messages.value[idx]
  if (!prev || !cur) return true
  if (prev.senderType !== cur.senderType) return true
  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() > 2 * 60_000
}
function endsGroup(idx: number): boolean {
  if (idx === messages.value.length - 1) return true
  const cur = messages.value[idx]
  const next = messages.value[idx + 1]
  if (!cur || !next) return true
  if (cur.senderType !== next.senderType) return true
  return new Date(next.createdAt).getTime() - new Date(cur.createdAt).getTime() > 2 * 60_000
}
function bubbleShape(idx: number): string {
  const s = startsGroup(idx), e = endsGroup(idx)
  if (s && e) return 'b-solo'
  if (s) return 'b-first'
  if (e) return 'b-last'
  return 'b-mid'
}
function needsDaySeparator(idx: number): boolean {
  if (idx === 0) return messages.value.length > 0
  const prev = messages.value[idx - 1]
  const cur = messages.value[idx]
  if (!prev || !cur) return false
  return new Date(prev.createdAt).toDateString() !== new Date(cur.createdAt).toDateString()
}
function formatDay(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Сегодня'
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

// === Helpers ===
const avatarColors = ['orange', 'blue', 'green', 'purple', 'pink', 'teal']
function avatarColor(id: number) { return avatarColors[id % avatarColors.length] }
function initials(first: string, last?: string | null) {
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?'
}
// For chat-list rows: today → HH:MM, this week → day abbr, older → date
function formatTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  const oneWeek = 7 * 24 * 60 * 60 * 1000
  if (now.getTime() - d.getTime() < oneWeek) {
    return d.toLocaleDateString('ru', { weekday: 'short' })
  }
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

// For message bubbles: always HH:MM — the day separator above already
// shows the date, so showing "вт" inside a bubble is redundant.
function formatMessageTime(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
}

function formatVideoDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Telegram-like: round videos autoplay muted; clicking toggles sound + pause
function toggleVideoNote(e: MouseEvent) {
  const wrap = e.currentTarget as HTMLElement
  const video = wrap.querySelector('video') as HTMLVideoElement | null
  if (!video) return
  if (video.muted) {
    video.muted = false
    video.currentTime = 0
    video.play().catch(() => {})
  } else {
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `Сегодня, ${d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`
  }
  return d.toLocaleDateString('ru', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}
function statusLabel(s: string) {
  return s === 'new' ? 'Новый' : s === 'active' ? 'В работе' : 'Закрыт'
}

onMounted(async () => {
  const token = getToken()
  if (token) connect(token)
  setupRealtime()
})
</script>

<style scoped>
/* ===== Search ===== */
.search-wrap {
  position: relative;
  width: 100%;
}
.search-input {
  width: 100%;
  height: 38px;
  background: var(--p-surface-100);
  border: 1px solid transparent;
  border-radius: 9999px;
  padding: 0 36px 0 36px;
  font-size: 13.5px;
  color: var(--p-surface-900);
  outline: none;
  transition: background-color 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.search-input::placeholder { color: var(--p-surface-400); }
.search-input:focus {
  background: var(--p-surface-0);
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 14%, transparent);
}
.search-icon {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--p-surface-400);
  font-size: 13px;
  pointer-events: none;
}
.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-surface-500);
  background: color-mix(in srgb, var(--p-surface-900) 8%, transparent);
  font-size: 10px;
}
.search-clear:hover { background: color-mix(in srgb, var(--p-surface-900) 14%, transparent); }

/* ===== Filter pills ===== */
.filter-bar {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin: 0 -4px;
  padding: 0 4px 2px;
  scrollbar-width: none;
}
.filter-bar::-webkit-scrollbar { display: none; }
.filter-pill {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--p-surface-500);
  background: var(--p-surface-100);
  transition: all 0.15s;
  white-space: nowrap;
}
.filter-pill:hover { background: color-mix(in srgb, var(--p-surface-200) 80%, transparent); color: var(--p-surface-700); }
.filter-pill-active {
  background: var(--p-primary-color) !important;
  color: var(--p-primary-contrast-color, #fff) !important;
}
.filter-count {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9999px;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  background: color-mix(in srgb, var(--p-surface-900) 8%, transparent);
  color: var(--p-surface-600);
}
.filter-count-active {
  background: rgba(255, 255, 255, 0.28) !important;
  color: #fff !important;
}

/* ===== Chat list rows ===== */
.chat-row {
  width: 100%;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.1s;
  text-align: left;
  background: transparent;
}
.chat-row:hover { background: var(--p-surface-100); }
.chat-row-active { background: var(--p-surface-100); }
[data-theme="dark"] .chat-row-active { background: color-mix(in srgb, var(--p-primary-color) 18%, transparent); }

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}
.status-dot-new { background: var(--p-blue-500, #3b82f6); box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-blue-500, #3b82f6) 25%, transparent); }
.status-dot-closed { background: var(--p-surface-400); }

.unread-badge {
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, #fff);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 999px;
  min-width: 20px;
  text-align: center;
}

/* ===== Avatars ===== */
.avatar-circle {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  font-weight: 700;
  color: #fff;
  width: 42px;
  height: 42px;
  font-size: 14px;
}
.avatar-circle.sm { width: 28px; height: 28px; font-size: 11px; }
.avatar-circle.md { width: 42px; height: 42px; font-size: 14px; }
.avatar-circle.orange { background: linear-gradient(135deg, #fb923c, #c2410c); }
.avatar-circle.blue   { background: linear-gradient(135deg, #60a5fa, #1d4ed8); }
.avatar-circle.green  { background: linear-gradient(135deg, #34d399, #047857); }
.avatar-circle.purple { background: linear-gradient(135deg, #a78bfa, #6d28d9); }
.avatar-circle.pink   { background: linear-gradient(135deg, #f472b6, #be185d); }
.avatar-circle.teal   { background: linear-gradient(135deg, #2dd4bf, #0f766e); }

/* ===== Chat area background ===== */
.chat-area-bg {
  background-color: var(--chat-bg);
  background-image: var(--chat-bg-pattern);
}

/* ===== Header status badge ===== */
.header-status {
  font-size: 11.5px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 9999px;
}
.header-status-new { background: color-mix(in srgb, var(--p-blue-500, #3b82f6) 14%, transparent); color: var(--p-blue-500, #3b82f6); }
.header-status-active { background: color-mix(in srgb, var(--p-green-500, #10b981) 14%, transparent); color: var(--p-green-500, #10b981); }
.header-status-closed { background: color-mix(in srgb, var(--p-surface-500) 14%, transparent); color: var(--p-surface-500); }

/* ===== Aside / panels ===== */
.chat-aside { border-right: 1px solid var(--divider); }
.chat-list-toolbar { border-bottom: 1px solid var(--divider); }
.chat-area-header { border-bottom: 1px solid var(--divider); }

/* ===== Day separator ===== */
.day-sep {
  display: flex;
  justify-content: center;
  margin: 12px 0;
}
.day-sep span {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--p-surface-900) 35%, transparent);
  color: #fff;
  backdrop-filter: blur(8px);
}

/* ===== Message bubbles ===== */
.message-row {
  display: flex;
  max-width: 70%;
}
.bubble {
  position: relative;
  padding: 7px 12px 7px 12px;
  font-size: 14.5px;
  line-height: 1.4;
  word-break: break-word;
  max-width: 100%;
  min-width: 60px;
}
.bubble.bubble-media { padding: 3px; min-width: 0; }

.bubble-text {
  white-space: pre-wrap;
}
/* Telegram trick: invisible inline span reserves space for the timestamp
   so text wraps around it instead of overlapping. */
.bubble-meta-inline {
  float: right;
  margin-left: 8px;
  margin-top: 5px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  user-select: none;
  white-space: nowrap;
}
.bubble-out .bubble-meta-inline { color: rgba(255, 255, 255, 0.85); }
.bubble-in .bubble-meta-inline { color: var(--p-surface-500); }

.bubble-meta {
  font-size: 10.5px;
  margin-top: 4px;
  opacity: 0.7;
  text-align: right;
  display: block;
  font-variant-numeric: tabular-nums;
}

/* Bubble fill styles */
.bubble-in {
  background: var(--bubble-in);
  color: var(--bubble-in-text);
  border: 1px solid var(--bubble-in-border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.bubble-out {
  background: var(--bubble-out);
  color: var(--bubble-out-text);
}

/* Grouped corners */
.bubble { border-radius: 16px; }
.self-end .bubble.b-solo  { border-bottom-right-radius: 4px; }
.self-end .bubble.b-first { border-bottom-right-radius: 4px; }
.self-end .bubble.b-mid   { border-bottom-right-radius: 4px; border-top-right-radius: 4px; }
.self-end .bubble.b-last  { border-top-right-radius: 4px; }
.self-start .bubble.b-solo  { border-bottom-left-radius: 4px; }
.self-start .bubble.b-first { border-bottom-left-radius: 4px; }
.self-start .bubble.b-mid   { border-bottom-left-radius: 4px; border-top-left-radius: 4px; }
.self-start .bubble.b-last  { border-top-left-radius: 4px; }

/* ===== Media (photo/video) ===== */
.media-wrap {
  position: relative;
  display: block;
  border-radius: 14px;
  overflow: hidden;
  max-width: 320px;
}
.media-img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 380px;
  object-fit: cover;
}
.bubble-meta-overlay {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 7px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  backdrop-filter: blur(4px);
}

/* ===== Document attachment ===== */
.doc-attachment {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: background-color 0.12s;
}
.bubble-in .doc-attachment:hover { background: rgba(0, 0, 0, 0.04); }
.bubble-out .doc-attachment:hover { background: rgba(255, 255, 255, 0.12); }
.doc-icon {
  display: flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  flex-shrink: 0;
  font-size: 15px;
}
.bubble-in .doc-icon { background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color); }
.bubble-out .doc-icon { background: rgba(255, 255, 255, 0.22); color: #fff; }

/* ===== Sticker ===== */
.sticker-display {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 2px 4px;
}
.sticker-emoji {
  font-size: 56px;
  line-height: 1;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.08));
}
.sticker-time {
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  margin-bottom: 4px;
  opacity: 0.6;
  white-space: nowrap;
}
/* Stickers should NOT have a bubble background — render the emoji bare */
.bubble:has(.sticker-display) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  color: var(--p-surface-700) !important;
}

/* ===== Video note (round Telegram-style short video) ===== */
.video-note {
  position: relative;
  width: 220px;
  height: 220px;
  cursor: pointer;
  border-radius: 9999px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}
.video-note-player {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: var(--p-surface-200);
}
.video-note-meta {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 9999px;
  backdrop-filter: blur(6px);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.video-note-time {
  position: absolute;
  top: 50%;
  right: -56px;
  transform: translateY(-50%);
  font-size: 10.5px;
  color: var(--p-surface-500);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.self-end .video-note-time { right: auto; left: -56px; }

/* Video-notes (like stickers) don't get a bubble background */
.bubble:has(.video-note) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  overflow: visible !important;
}

/* ===== Unsupported ===== */
.unsupported {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-style: italic;
  opacity: 0.75;
}
.unsupported i { font-size: 13px; }

/* ===== Scroll-down FAB ===== */
.scroll-down-btn {
  position: sticky;
  bottom: 8px;
  align-self: flex-end;
  margin-right: 4px;
  width: 42px;
  height: 42px;
  border-radius: 9999px;
  background: var(--p-surface-0);
  color: var(--p-surface-700);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  transition: transform 0.15s, background-color 0.15s;
  cursor: pointer;
  z-index: 5;
}
.scroll-down-btn:hover { transform: translateY(-1px); background: var(--p-surface-100); }
.scroll-down-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9999px;
  background: var(--p-primary-color);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(8px); }

/* ===== Composer ===== */
/* === Take-in-work confirmation dialog === */
/* === Right client info panel === */
.client-panel {
  width: 320px;
  flex-shrink: 0;
  background: var(--p-surface-0);
  border-left: 1px solid var(--divider);
  overflow-y: auto;
}
.info-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--p-surface-500);
}
.info-divider { height: 1px; background: var(--divider); }
.avatar-circle.lg { width: 84px; height: 84px; font-size: 30px; }
.avatar-circle.xs { width: 20px; height: 20px; font-size: 9px; }

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
}
.status-pill-booked { background: color-mix(in srgb, var(--p-green-500, #10b981) 16%, transparent); color: var(--p-green-500, #10b981); }
.status-pill-bought { background: color-mix(in srgb, var(--p-green-500, #10b981) 18%, transparent); color: var(--p-green-500, #10b981); }
.status-pill-thinking { background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color); }
.status-pill-consulting { background: color-mix(in srgb, var(--p-blue-500, #3b82f6) 14%, transparent); color: var(--p-blue-500, #3b82f6); }
.status-pill-waiting_price { background: color-mix(in srgb, var(--p-orange-500, #f97316) 14%, transparent); color: var(--p-orange-500, #f97316); }

.history-dot {
  width: 9px;
  height: 9px;
  border-radius: 9999px;
  margin-top: 6px;
  flex-shrink: 0;
  background: var(--p-primary-color);
}
.status-dot-thinking { background: var(--p-primary-color); }
.status-dot-consulting { background: var(--p-blue-500, #3b82f6); }
.status-dot-waiting_price { background: var(--p-orange-500, #f97316); }
.status-dot-booked { background: var(--p-green-500, #10b981); }
.status-dot-bought { background: var(--p-green-500, #10b981); }

/* ============= Close-chat dialog (custom) ============= */
:deep(.close-dialog.p-dialog) {
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.35);
}
:deep(.close-dialog .p-dialog-content) {
  padding: 0;
}

.close-dialog-body { display: flex; flex-direction: column; }

.close-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid var(--divider);
}
.close-x {
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-surface-500);
  flex-shrink: 0;
  transition: background 0.12s;
}
.close-x:hover { background: var(--p-surface-200); color: var(--p-surface-700); }

.close-body {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.close-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--divider);
  background: color-mix(in srgb, var(--p-surface-100) 50%, transparent);
}

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-surface-700);
  margin-bottom: 8px;
}

/* Two BaseInputs side-by-side with an arrow between */
.route-pair {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 8px;
  align-items: center;
}
.route-arrow {
  color: var(--p-surface-400);
  font-size: 13px;
  display: flex;
  justify-content: center;
}

/* === Status radio cards === */
.status-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.status-radio {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--p-surface-100);
  border: 1.5px solid transparent;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
[data-theme="dark"] .status-radio { background: color-mix(in srgb, var(--p-surface-200) 50%, transparent); }
.status-radio:hover { border-color: var(--p-surface-300); }
.status-radio-active {
  border-color: var(--p-primary-color) !important;
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent) !important;
}
.status-radio-mark {
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  border: 2px solid var(--p-surface-400);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--p-surface-0);
}
.status-radio-mark-active { border-color: var(--p-primary-color); }
.status-radio-dot {
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  background: var(--p-primary-color);
}


.take-icon {
  width: 56px;
  height: 56px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--p-primary-color) 6%, transparent);
}
:deep(.take-dialog.p-dialog) {
  border-radius: 18px;
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.25);
}
:deep(.take-dialog .p-dialog-content) {
  padding: 0 1.25rem 1.25rem;
  border-radius: 18px;
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  flex-shrink: 0;
  background: var(--p-surface-0);
  border-top: 1px solid var(--divider);
}
.composer-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: var(--p-surface-500);
  flex-shrink: 0;
  transition: background-color 0.12s, color 0.12s;
}
.composer-btn:hover { background: var(--p-surface-100); color: var(--p-surface-700); }
.composer-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.composer-input {
  flex: 1;
  border-radius: 16px;
  background: var(--p-surface-100);
  padding: 9px 14px;
  min-height: 40px;
  max-height: 160px;
  overflow-y: auto;
  transition: background-color 0.12s, box-shadow 0.12s;
}
.composer-input:focus-within {
  background: var(--p-surface-0);
  box-shadow: 0 0 0 1px var(--p-primary-color);
}
.composer-textarea {
  width: 100%;
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 14.5px;
  font-family: inherit;
  resize: none;
  line-height: 1.45;
  color: var(--p-surface-900);
  min-height: 22px;
  max-height: 140px;
}
.composer-textarea::placeholder { color: var(--p-surface-400); }

.composer-send {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: var(--p-surface-400);
  flex-shrink: 0;
  transition: all 0.15s;
}
.composer-send:disabled { cursor: not-allowed; }
.composer-send-active {
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, #fff);
}
.composer-send-active:hover { filter: brightness(1.08); transform: scale(1.04); }
</style>
