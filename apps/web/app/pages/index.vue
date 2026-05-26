<template>
  <div class="flex h-full overflow-hidden bg-surface-50">
    <ChatList
      :chats="chats"
      :active-id="activeChat?.id ?? null"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :filters="filters"
      @select="handleOpenChat"
      @load-more="loadMoreChats"
    />

    <!-- ============ Chat Area ============ -->
    <main
      v-if="activeChat"
      class="flex-1 flex flex-col min-w-0 chat-area-bg relative"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- Drag & drop overlay -->
      <Transition name="fade">
        <div v-if="isDragging" class="drop-overlay">
          <div class="drop-overlay-box">
            <i class="pi pi-cloud-upload" />
            <div class="drop-overlay-title">Перетащите файлы сюда</div>
            <div class="drop-overlay-sub">фото, видео и документы</div>
          </div>
        </div>
      </Transition>

      <ChatHeader
        :chat="activeChat"
        @assign="handleAssign"
        @close="handleClose"
        @reopen="handleReopen"
        @transfer="transferOpen = true"
      />

      <!-- Messages -->
      <div class="messages-wrap">
        <div
          class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-0.5"
          ref="messagesEl"
          @scroll="onScroll"
        >
          <div class="flex items-center justify-center py-2">
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

            <!-- System notices (transfers, etc.) — centered, not a chat bubble -->
            <div v-if="msg.senderType === 'system'" class="system-note">
              <span>{{ msg.content?.text || 'Системное сообщение' }}</span>
            </div>

            <div
              v-else
              class="message-row group"
              :class="[
                msg.senderType === 'manager' ? 'self-end' : 'self-start',
                startsGroup(idx) ? 'mt-2.5' : 'mt-0.5',
              ]"
              :data-msg-id="msg.id"
            >
              <MessageBubble
                :msg="msg"
                :shape="bubbleShape(idx)"
                :is-media-only="isMediaOnly(msg)"
                :reply-target="findReplyTarget(msg)"
                @contextmenu="onContextMenu"
                @jump-to="jumpToMessage"
              />
            </div>
          </template>
        </div>

        <!-- Floating "scroll-to-bottom" button — absolute over the messages list -->
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

      <Composer
        ref="composerRef"
        v-model="composerText"
        :editing-message="editingMessage"
        :replying-to="replyingTo"
        :uploading="uploading"
        :attachments="attachments.items.value"
        @send="handleSend"
        @cancel-edit="cancelEditing"
        @cancel-reply="cancelReplying"
        @add-files="onAddFiles"
        @remove-attachment="attachments.remove"
      />
    </main>

    <!-- Empty chat state -->
    <main v-else class="flex-1 flex flex-col items-center justify-center gap-4 chat-area-bg text-surface-400">
      <div class="w-20 h-20 rounded-full bg-surface-100 flex items-center justify-center">
        <i class="pi pi-comments text-3xl opacity-50" />
      </div>
      <p class="text-sm">Выберите чат, чтобы начать переписку</p>
    </main>

    <ClientInfoSidebar v-if="activeChat" :chat="activeChat" :info="clientInfo" />

    <TakeChatDialog
      v-model:open="takeDialog.open"
      @cancel="cancelTake"
      @accept="acceptTake"
    />

    <MessageContextMenu
      v-if="actionMenuPos && actionMenuMsg"
      :msg="actionMenuMsg"
      :pos="actionMenuPos"
      :can-reply="canReply(actionMenuMsg)"
      :can-edit="canEdit(actionMenuMsg)"
      :can-delete="canDelete(actionMenuMsg)"
      @reply="startReplying"
      @edit="startEditingMessage"
      @delete="askDelete"
    />

    <DeleteMessageDialog
      :open="deleteDialog.open"
      @update:open="(v: boolean) => deleteDialog = { open: v, messageId: v ? deleteDialog.messageId : null }"
      @confirm="confirmDelete"
    />

    <CloseChatDialog
      v-model:open="closeChatOpen"
      :saving="closeChatSaving"
      @confirm="onCloseConfirm"
    />

    <TransferChatDialog
      v-model:open="transferOpen"
      :saving="transferSaving"
      :current-assignee-id="transferAssigneeId"
      @confirm="onTransferConfirm"
    />

    <AdminTakeoverDialog
      :open="guardDialog.open"
      :owner-name="guardDialog.ownerName"
      :action-label="guardDialog.actionLabel"
      @update:open="(v: boolean) => !v && cancelTakeover()"
      @confirm="confirmTakeover"
    />
  </div>
</template>

<script setup lang="ts">
import ChatList from '~/components/chat/ChatList.vue'
import ChatHeader from '~/components/chat/ChatHeader.vue'
import Composer from '~/components/chat/Composer.vue'
import ClientInfoSidebar from '~/components/chat/ClientInfoSidebar.vue'
import MessageBubble from '~/components/chat/MessageBubble.vue'
import MessageContextMenu from '~/components/chat/MessageContextMenu.vue'
import TakeChatDialog from '~/components/chat/dialogs/TakeChatDialog.vue'
import DeleteMessageDialog from '~/components/chat/dialogs/DeleteMessageDialog.vue'
import CloseChatDialog, { type ClosePayload } from '~/components/chat/dialogs/CloseChatDialog.vue'
import TransferChatDialog, { type TransferPayload } from '~/components/chat/dialogs/TransferChatDialog.vue'
import AdminTakeoverDialog from '~/components/chat/dialogs/AdminTakeoverDialog.vue'
import { formatDay } from '~/utils/format'

definePageMeta({ middleware: 'auth' })

const {
  chats, activeChat, messages, loading, loadingMore, hasMore, filters, loadMoreChats,
  openChat, loadOlder, sendMessage, editMessage, deleteMessage,
  assignChat, closeChat, reopenChat, transferChat, loadClientInfo, setupRealtime,
} = useChats()

type ClientInfoData = Awaited<ReturnType<typeof loadClientInfo>>
const clientInfo = ref<ClientInfoData | null>(null)
const closeChatOpen = ref(false)
const closeChatSaving = ref(false)
const composerText = ref('')
const uploading = ref(false)

// Files queued in the composer before sending (Telegram-style preview tray).
const attachments = useAttachments()
const composerRef = ref<{ focus: () => void; focusNow: () => void } | null>(null)

// === Edit / Delete / Reply state via composable ===
const {
  editingMessage, replyingTo, deleteDialog, actionMenuPos, actionMenuMsg,
  canEdit, canDelete, canReply,
  startEditing, cancelEditing,
  startReplying, cancelReplying,
  askDelete: askDeleteRaw, confirmDelete, onContextMenu,
  closeActionMenu,
} = useMessageActions({ editMessage, deleteMessage })

// === Admin takeover guard ===
// Wraps actions that admin might perform on another manager's chat.
// `onTakeover` runs as soon as admin confirms the modal — calls /chats/:id/assign
// so the chat ownership flips immediately, before the underlying action completes.
const { guardDialog, withGuard, confirm: confirmTakeover, cancel: cancelTakeover } = useAdminTakeoverGuard({
  onTakeover: (chatId) => assignChat(chatId),
})

function askDelete(msg: typeof actionMenuMsg.value) {
  if (!msg) return
  closeActionMenu()  // Close the right-click menu first — modal must not stack on top of it
  withGuard(activeChat.value, 'удалить сообщение', () => askDeleteRaw(msg))
}

// === Scroll state via composable ===
const {
  messagesEl, loadingOlder, historyExhausted,
  showScrollDown, newSinceUnscrolled,
  onScroll, scrollToBottom, resetForChat,
} = useChatScroll({
  activeChatId: computed(() => activeChat.value?.id ?? null),
  lastMessageId: computed(() => messages.value[messages.value.length - 1]?.id ?? null),
  loadOlder,
})

const { getToken } = useAuth()
const { connect } = useSocket()

// Bridge: composable owns editText, but composer is v-model'd on a separate ref
function startEditingMessage(msg: typeof actionMenuMsg.value) {
  if (!msg) return
  closeActionMenu()  // Close the right-click menu first — modal must not stack on top of it
  withGuard(activeChat.value, 'изменить сообщение', () => {
    startEditing(msg)
    composerText.value = msg.content?.type === 'text'
      ? (msg.content.text ?? '')
      : (msg.content?.caption ?? '')
    nextTick(() => {
      const ta = document.querySelector('.composer-textarea') as HTMLTextAreaElement | null
      ta?.focus()
    })
  })
}

async function handleSend() {
  if (!activeChat.value) return
  const body = composerText.value.trim()
  const hasFiles = attachments.items.value.length > 0
  if (!body && !hasFiles) return

  // Edit mode — takeover was already confirmed at startEditingMessage.
  // (Editing never carries attachments.)
  if (editingMessage.value) {
    if (!body) return
    await editMessage(editingMessage.value.id, body)
    cancelEditing()
    composerText.value = ''
    return
  }

  const replyTargetId = replyingTo.value?.id

  // New chat flow — needs to be claimed first
  if (activeChat.value.status === 'new') {
    askTakeChat(async () => {
      try { await assignChat(activeChat.value!.id) } catch { return }
      await refreshClientInfo(activeChat.value!.id)   // "Взят в работу" → history
      await doDispatch(body, replyTargetId)
    })
    return
  }

  // Admin sending to another manager's chat — confirm takeover first
  withGuard(activeChat.value, 'отправить сообщение', () => doDispatch(body, replyTargetId))
}

/** Sends queued attachments (if any) and/or the text body, then resets the composer. */
async function doDispatch(body: string, replyTo?: string) {
  const files = attachments.items.value
  if (files.length > 0) {
    await doUpload(files.map(a => a.file), body)
  } else if (body) {
    await sendMessage(body, replyTo)
  }
  composerText.value = ''
  attachments.clear()
  cancelReplying()
  await nextTick()
  scrollToBottom()
}

/** Upload all queued files in one request — the API groups photos/videos into
 *  a Telegram album and sends documents individually. Caption goes on the first. */
async function doUpload(files: File[], caption: string) {
  uploading.value = true
  try {
    const { api } = useApi()
    const form = new FormData()
    for (const f of files) form.append('files', f)
    if (caption) form.append('caption', caption)
    await api(`/chats/${activeChat.value!.id}/upload`, { method: 'POST', body: form })
    await nextTick()
    scrollToBottom()
  } finally {
    uploading.value = false
  }
}

// === Add files (from picker, drag-drop, or paste) ===
function onAddFiles(files: File[]) {
  attachments.add(files)
  nextTick(() => composerRef.value?.focusNow())
}

// === Drag & drop ===
const isDragging = ref(false)
let dragDepth = 0
function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth++
  isDragging.value = true
}
function onDragOver(e: DragEvent) {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDragging.value = false
}
function onDrop(e: DragEvent) {
  dragDepth = 0
  isDragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) onAddFiles(files)
}

// === Take/assign flow ===
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
  await cb?.()
}

async function handleAssign() {
  if (!activeChat.value) return
  await assignChat(activeChat.value.id)
  await refreshClientInfo(activeChat.value.id)   // surface "Взят в работу" in history
}

function handleClose() {
  if (!activeChat.value) return
  withGuard(activeChat.value, 'закрыть чат', () => { closeChatOpen.value = true })
}

function handleReopen() {
  if (!activeChat.value) return
  withGuard(activeChat.value, 'переоткрыть чат', async () => {
    await reopenChat(activeChat.value!.id)
    await refreshClientInfo(activeChat.value!.id)
  })
}

async function onCloseConfirm(payload: ClosePayload) {
  if (!activeChat.value) return
  closeChatSaving.value = true
  try {
    await closeChat({ chatId: activeChat.value.id, data: payload })
    closeChatOpen.value = false
    if (activeChat.value) await refreshClientInfo(activeChat.value.id)
  } finally {
    closeChatSaving.value = false
  }
}

// === Transfer flow ===
const transferOpen = ref(false)
const transferSaving = ref(false)
const transferAssigneeId = computed(() => activeChat.value?.assignedTo ?? null)

async function onTransferConfirm(payload: TransferPayload) {
  if (!activeChat.value) return
  transferSaving.value = true
  try {
    const chatId = activeChat.value.id
    await transferChat({ chatId, toUserId: payload.toUserId, comment: payload.comment })
    transferOpen.value = false
    if (activeChat.value?.id === chatId) await refreshClientInfo(chatId)
  } catch (e: any) {
    alert(e?.data?.message || 'Не удалось передать чат')
  } finally {
    transferSaving.value = false
  }
}

async function refreshClientInfo(chatId: string) {
  try { clientInfo.value = await loadClientInfo(chatId) }
  catch { clientInfo.value = null }
}

// === Message grouping helpers ===
function startsGroup(idx: number): boolean {
  if (idx === 0) return true
  const prev = messages.value[idx - 1]
  const cur = messages.value[idx]
  if (!prev || !cur) return true
  if (prev.senderType !== cur.senderType) return true
  return (new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime()) > 5 * 60 * 1000
}
function endsGroup(idx: number): boolean {
  const cur = messages.value[idx]
  const next = messages.value[idx + 1]
  if (!cur || !next) return true
  if (cur.senderType !== next.senderType) return true
  return (new Date(next.createdAt).getTime() - new Date(cur.createdAt).getTime()) > 5 * 60 * 1000
}
function bubbleShape(idx: number): string {
  const start = startsGroup(idx)
  const end = endsGroup(idx)
  if (start && end) return 'b-solo'
  if (start) return 'b-top'
  if (end) return 'b-bot'
  return 'b-mid'
}
function needsDaySeparator(idx: number): boolean {
  if (idx === 0) return messages.value.length > 0
  const prev = messages.value[idx - 1]
  const cur = messages.value[idx]
  if (!prev || !cur) return false
  return new Date(prev.createdAt).toDateString() !== new Date(cur.createdAt).toDateString()
}

function isMediaOnly(msg: any): boolean {
  const t = msg.content?.type
  if (t !== 'photo' && t !== 'video' && t !== 'videoNote') return false
  return !msg.content?.caption
}

/** Locally resolve the message a reply points to (by TG message id within the chat). */
function findReplyTarget(msg: { replyToTgId?: number | null }) {
  if (!msg.replyToTgId) return null
  return messages.value.find(m => m.telegramMessageId === msg.replyToTgId) ?? null
}

/** Smooth-scroll to a message in the list when its reply quote is clicked. */
function jumpToMessage(messageId: string) {
  const el = document.querySelector(`[data-msg-id="${messageId}"]`) as HTMLElement | null
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('msg-flash')
  setTimeout(() => el.classList.remove('msg-flash'), 1200)
}

async function handleOpenChat(id: string) {
  resetForChat()
  attachments.clear()        // don't carry queued files between chats
  composerText.value = ''
  await openChat(id)
  await refreshClientInfo(id)
  await nextTick()
  scrollToBottom()
  composerRef.value?.focus()  // ready to type immediately
}

/** Type-to-focus: pressing a printable key anywhere jumps into the composer,
 *  so you can open a chat and just start typing (Telegram/Slack behaviour). */
function onGlobalKeydown(e: KeyboardEvent) {
  if (!activeChat.value) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key.length !== 1) return  // ignore Enter, Tab, arrows, F-keys, etc.
  const t = e.target as HTMLElement | null
  const tag = t?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
  composerRef.value?.focusNow()
}

// Deep-link: /?chat=<id> (from a notification click) opens that chat.
const route = useRoute()
watch(() => route.query.chat, (id) => {
  if (typeof id === 'string' && id && id !== activeChat.value?.id) handleOpenChat(id)
}, { immediate: true })

onMounted(async () => {
  const token = getToken()
  if (token) connect(token)
  setupRealtime()
  window.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<style>
/* ===== Search =====
   NOTE: NOT scoped — these styles target classes used inside extracted
   child components (ChatList, ChatHeader, Composer, ClientInfoSidebar,
   MessageBubble, dialogs). Class names are specific enough that going
   global is safe. */

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

/* System notices (chat transfers, etc.) — centered chip in the timeline */
.system-note {
  display: flex;
  justify-content: center;
  margin: 10px 0;
}
.system-note span {
  max-width: 80%;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  color: var(--p-primary-700, var(--p-primary-color));
  text-align: center;
  line-height: 1.4;
}

/* ===== Message bubbles ===== */
.message-row {
  display: flex;
  max-width: 70%;
}

/* Highlight flash when scrolled-to from a reply quote click */
.message-row.msg-flash > .bubble {
  animation: msg-flash 1.2s ease-out;
}
@keyframes msg-flash {
  0%   { box-shadow: 0 0 0 4px var(--p-primary-200); }
  100% { box-shadow: 0 0 0 0 transparent; }
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
/* Container that lets us float the FAB over the scrollable messages list. */
.messages-wrap {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;            /* allows the inner scroll area to actually scroll */
}
.messages-wrap > div:first-child { flex: 1; min-height: 0; }

.scroll-down-btn {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  border-radius: 50%;
  background: var(--p-surface-0);
  color: var(--p-surface-700);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  transition: transform 0.15s, background-color 0.15s;
  cursor: pointer;
  z-index: 5;
  border: 1px solid var(--divider);
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
.close-dialog.p-dialog {
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.35);
}
.close-dialog .p-dialog-content {
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
.take-dialog.p-dialog {
  border-radius: 18px;
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.25);
}
.take-dialog .p-dialog-content {
  padding: 0 1.25rem 1.25rem;
  border-radius: 18px;
}

/* ===== Floating context menu (right-click, TG-style) ===== */
/* Teleported to body — see global <style> at the bottom of the file */
.msg-action-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--p-surface-700);
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}
.msg-action-item:hover { background: var(--p-surface-100); }
.msg-action-danger { color: #ef4444; }
.msg-action-danger:hover { background: rgba(239, 68, 68, 0.08); }

.bubble-edited::after {
  content: 'изменено';
  font-size: 10px;
  white-space: nowrap;
  opacity: 0.6;
  font-style: italic;
}

/* ===== Edit indicator above composer ===== */
.edit-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: var(--p-surface-50);
  border-top: 1px solid var(--divider);
  border-left: 3px solid var(--p-primary-500);
}
.edit-indicator > .pi-pencil { color: var(--p-primary-500); font-size: 14px; }
.edit-indicator-body { flex: 1; min-width: 0; }
.edit-indicator-title { font-size: 12px; font-weight: 600; color: var(--p-primary-600); }
.edit-indicator-preview {
  font-size: 13px;
  color: var(--p-surface-600);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.edit-indicator-close {
  width: 24px; height: 24px;
  border-radius: 50%;
  background: none;
  border: none;
  color: var(--p-surface-500);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.edit-indicator-close:hover { background: var(--p-surface-100); }

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

/* ===== Attachment preview tray ===== */
.attach-tray {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px 16px 4px;
  background: var(--p-surface-0);
  border-top: 1px solid var(--divider);
  overflow-x: auto;
  scrollbar-width: thin;
}
.attach-item {
  position: relative;
  flex-shrink: 0;
  width: 84px;
  height: 84px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--p-surface-200);
  background: var(--p-surface-100);
}
.attach-item-file {
  width: auto;
  min-width: 180px;
  max-width: 240px;
  height: 64px;
  border-radius: 10px;
}
.attach-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.attach-video { position: relative; }
.attach-video-el { width: 100%; height: 100%; object-fit: cover; display: block; }
.attach-video-icon {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  font-size: 18px;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}
.attach-fileinfo {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
  padding: 0 12px;
}
.attach-fileicon {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.03em;
}
.attach-filemeta { min-width: 0; }
.attach-filename {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--p-surface-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.attach-filesize { font-size: 11px; color: var(--p-surface-500); margin-top: 1px; }
.attach-remove {
  position: absolute;
  top: 3px; right: 3px;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 9px;
  backdrop-filter: blur(4px);
  transition: background 0.12s;
}
.attach-remove:hover { background: rgba(0, 0, 0, 0.75); }
.attach-add {
  flex-shrink: 0;
  width: 84px;
  height: 84px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px dashed var(--p-surface-300);
  color: var(--p-surface-400);
  font-size: 18px;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.attach-add:hover {
  border-color: var(--p-primary-color);
  color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
}

/* ===== Drag & drop overlay ===== */
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  backdrop-filter: blur(2px);
  pointer-events: none;
}
.drop-overlay-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 48px;
  border-radius: 20px;
  border: 2.5px dashed var(--p-primary-color);
  background: color-mix(in srgb, var(--p-surface-0) 80%, transparent);
}
.drop-overlay-box > .pi { font-size: 38px; color: var(--p-primary-color); }
.drop-overlay-title { font-size: 16px; font-weight: 700; color: var(--p-surface-900); }
.drop-overlay-sub { font-size: 12.5px; color: var(--p-surface-500); }
</style>

<!-- Global styles for elements that teleport outside the page (body) -->
<style>
.msg-context-menu {
  position: fixed;
  background: var(--p-overlay-modal-background, var(--p-surface-0));
  border: 1px solid var(--p-overlay-modal-border-color, var(--divider));
  border-radius: 10px;
  padding: 4px;
  min-width: 180px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
  z-index: 9999;
  animation: msg-menu-in 0.12s ease-out;
}
@keyframes msg-menu-in {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}
.msg-context-menu .msg-action-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  font-size: 13px;
  color: var(--p-surface-700);
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}
.msg-context-menu .msg-action-item:hover { background: var(--p-surface-100); }
.msg-context-menu .msg-action-danger { color: #ef4444; }
.msg-context-menu .msg-action-danger:hover { background: rgba(239, 68, 68, 0.08); }
</style>
