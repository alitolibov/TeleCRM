/** Same bucket set the API stores (mirrors TDLib's UserStatus types). */
export type ClientOnlineStatus =
  | 'online' | 'offline' | 'recently'
  | 'last_week' | 'last_month' | 'long_ago' | 'empty'

export interface ChatClient {
  id: string
  telegramId: number
  firstName: string
  lastName?: string
  username?: string
  /** E.164. Stored once we ever see it from TDLib; doesn't disappear if the
   *  client later hides it again. */
  phone?: string | null
  /** Latest known online-status bucket from TDLib. Null = never seen yet. */
  onlineStatus?: ClientOnlineStatus | null
  /** Precise last-seen ISO timestamp — only set when status === 'offline'. */
  lastSeenAt?: string | null
}

export interface ChatMessage {
  id: string
  chatId: string
  telegramMessageId: number
  senderType: 'client' | 'manager' | 'system'
  /** UUID of the user who sent it (null for client-sent / system messages). */
  senderId?: string | null
  contentType: string
  content: any
  isRead: boolean
  /** Set when the OTHER side read this outgoing message (TDLib outbox-read).
   *  Drives the ✓ → ✓✓ flip in MessageBubble for every content type. */
  readAt?: string | null
  /** Delivery state for outgoing messages: queued → confirmed by Telegram. */
  status?: 'sending' | 'sent' | 'failed'
  createdAt: string
  editedAt?: string | null
  replyToTgId?: number | null
  /** Forwarded message — drives the "Переслано от …" banner above the bubble.
   *  Source can be the original TG forward (regular chat) or a CRM forward
   *  into Favorites; both are normalised to the same `{ name, sentAt }` shape
   *  before reaching the bubble template. */
  forwardedFrom?: { name: string; sentAt: string }
}

export interface Chat {
  id: string
  status: 'new' | 'active' | 'closed'
  unreadCount: number
  lastMessageAt: string | null
  createdAt: string
  client: ChatClient
  /** UUID of the manager who owns this chat (mirrors backend `assignedTo`). */
  assignedTo?: string | null
  assignedUser?: { id: string; firstName: string; username: string } | null
  /** CRM has a `contacts` row for this client → header/sidebar drop the @nick
   *  in favour of the team-chosen name. */
  hasCrmContact?: boolean
  /** The CRM-account's Telegram has this user in its address book → the
   *  sidebar button shows "В контактах" instead of "Добавить в контакты".
   *  Set independently of `hasCrmContact` so deleting the contact in TG
   *  (or pre-existing TG contacts) flip the button correctly. */
  inTelegramContacts?: boolean
  /** All currently pinned messages, oldest first (latest at the end) — matches
   *  the server's chats.pinned_message_ids stack. The banner cycles through. */
  pinnedMessages?: ChatMessage[]
  /** Mirror of pinned_message_ids — WS chat:updated carries this even when
   *  the full message objects aren't included, so the array doesn't drift. */
  pinnedMessageIds?: string[]
  messages?: ChatMessage[]
  lastMessage?: ChatMessage | null
}

export const useChatsStore = defineStore('chats', () => {
  const chats = ref<Chat[]>([])
  const activeChat = ref<Chat | null>(null)
  const messages = ref<ChatMessage[]>([])

  const totalUnread = computed(() => chats.value.reduce((s, c) => s + (c.unreadCount ?? 0), 0))

  /**
   * For managers, a chat must be visible only when assigned to them.
   * Admin sees everything. The backend already filters /chats by role, but
   * WS broadcasts go to everyone — so the store also filters at apply-time.
   */
  function isVisibleToCurrentUser(chat: { assignedTo?: string | null }): boolean {
    const auth = useAuthStore()
    if (!auth.user) return false
    if (auth.user.role === 'admin') return true
    return chat.assignedTo === auth.user.id
  }

  function setChats(data: Chat[]) { chats.value = data }

  /** Append the next page of chats (load-more), skipping any already present. */
  function appendChats(data: Chat[]) {
    const seen = new Set(chats.value.map(c => c.id))
    const fresh = data.filter(c => !seen.has(c.id))
    if (fresh.length) chats.value = [...chats.value, ...fresh]
  }

  function setActiveChat(chat: Chat) {
    activeChat.value = chat
    messages.value = chat.messages ?? []
  }

  function markActiveChatRead() {
    const chat = chats.value.find(c => c.id === activeChat.value?.id)
    if (chat) chat.unreadCount = 0
  }

  function handleNewMessage(msg: ChatMessage & { client: ChatClient }) {
    if (activeChat.value?.id === msg.chatId && !messages.value.some(m => m.id === msg.id)) {
      messages.value = [...messages.value, msg]
    }
    // Reorder only — unreadCount and lastMessageAt come authoritatively from
    // the chat:updated / chat:new event that the backend emits before this one.
    // Incrementing here too would double-count notifications.
    const chat = chats.value.find(c => c.id === msg.chatId)
    if (chat) {
      chats.value = [chat, ...chats.value.filter(c => c.id !== msg.chatId)]
    }
  }

  function handleChatUpdated(data: Partial<Chat> & { id: string }) {
    const existing = chats.value.find(c => c.id === data.id)
    const projectedAssignedTo = data.assignedTo !== undefined ? data.assignedTo : existing?.assignedTo
    const projectedChat = { ...(existing ?? {}), ...data, assignedTo: projectedAssignedTo } as Chat
    const visible = isVisibleToCurrentUser(projectedChat)

    // For managers: if the chat's ownership flipped away from us, drop it.
    if (existing && !visible) {
      chats.value = chats.value.filter(c => c.id !== data.id)
      if (activeChat.value?.id === data.id) activeChat.value = null
      return
    }

    // If we don't have the chat yet but it's now visible, add it (handles
    // auto-distribute that targets this manager — server emits chat:updated,
    // not chat:new, so we'd otherwise miss the chat entirely).
    if (!existing && visible) {
      chats.value = [projectedChat, ...chats.value]
      return
    }

    if (!existing) return  // not visible and not present — ignore

    // Existing visible chat — merge fields and replace in array for reactivity.
    const isActive = activeChat.value?.id === data.id
    const overrides = isActive && data.unreadCount !== undefined ? { unreadCount: 0 } : {}
    const merged: Partial<Chat> = { ...data, ...overrides }
    // Client patches come through partial — the API only sends what changed
    // (e.g. just `onlineStatus`). Deep-merge so we don't blow away the
    // existing first/last name when the patch only carries presence fields.
    if (data.client && existing.client) {
      merged.client = { ...existing.client, ...data.client } as ChatClient
    }
    chats.value = chats.value.map(c => c.id === data.id ? ({ ...c, ...merged } as Chat) : c)
    if (isActive) activeChat.value = { ...activeChat.value, ...merged } as Chat
  }

  function handleNewChat(chat: Chat) {
    if (!isVisibleToCurrentUser(chat)) return
    if (!chats.value.find(c => c.id === chat.id)) chats.value.unshift(chat)
  }

  function addMessage(msg: ChatMessage) {
    if (!messages.value.some(m => m.id === msg.id)) {
      messages.value = [...messages.value, msg]
    }
    const chat = chats.value.find(c => c.id === msg.chatId)
    if (chat) {
      chat.lastMessageAt = msg.createdAt
      chat.lastMessage = msg
      chats.value = [chat, ...chats.value.filter(c => c.id !== msg.chatId)]
    }
  }

  function handleMessageEdited(payload: { id: string; chatId: string; content: any; editedAt: string }) {
    if (activeChat.value?.id !== payload.chatId) return
    const idx = messages.value.findIndex(m => m.id === payload.id)
    if (idx === -1) return
    messages.value = messages.value.map((m, i) =>
      i === idx ? { ...m, content: payload.content, editedAt: payload.editedAt } : m,
    )
  }

  /** Outgoing message confirmed (or failed) by Telegram — flip its delivery state. */
  function handleMessageStatus(payload: { id: string; chatId: string; status: 'sending' | 'sent' | 'failed'; telegramMessageId?: number }) {
    const idx = messages.value.findIndex(m => m.id === payload.id)
    if (idx === -1) return
    messages.value = messages.value.map((m, i) =>
      i === idx
        ? { ...m, status: payload.status, ...(payload.telegramMessageId ? { telegramMessageId: payload.telegramMessageId } : {}) }
        : m,
    )
  }

  function handleMessagesDeleted(payload: { ids: string[] }) {
    const setIds = new Set(payload.ids)
    messages.value = messages.value.filter(m => !setIds.has(m.id))
  }

  /** Insert older messages at the top of the list, sorted chronologically. */
  function prependMessages(msgs: ChatMessage[]) {
    if (msgs.length === 0) return 0
    const existing = new Set(messages.value.map(m => m.id))
    const fresh = msgs.filter(m => !existing.has(m.id))
    if (fresh.length === 0) return 0
    const merged = [...fresh, ...messages.value]
    merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    messages.value = merged
    return fresh.length
  }

  /** Insert arbitrary messages anywhere in the list (jump-to-message context).
   *  Sorted chronologically; duplicates by id are dropped. Returns count added. */
  function mergeMessages(msgs: ChatMessage[]) {
    if (msgs.length === 0) return 0
    const existing = new Set(messages.value.map(m => m.id))
    const fresh = msgs.filter(m => !existing.has(m.id))
    if (fresh.length === 0) return 0
    const merged = [...messages.value, ...fresh]
    merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    messages.value = merged
    return fresh.length
  }

  /** The other side read our outgoing messages — flip ✓ → ✓✓ in the local
   *  message list for whatever ids are in the payload. */
  function handleOutboxRead(payload: { chatId: string; ids: string[]; readAt: string }) {
    if (activeChat.value?.id !== payload.chatId) return
    const idSet = new Set(payload.ids)
    if (idSet.size === 0) return
    messages.value = messages.value.map(m =>
      idSet.has(m.id) ? { ...m, readAt: payload.readAt } : m,
    )
  }

  // === Typing / chat-action state ===
  // Per-chat current action with an auto-expiry timestamp. We don't trust
  // TDLib to always emit `cancel` — and even when it does, frequent typing
  // events overlap with end-of-action events. A 6-second window matches the
  // ~5 s cadence TDLib uses while typing is ongoing.
  type ChatActionEntry = { action: string; until: number }
  const chatActions = ref<Record<string, ChatActionEntry>>({})
  // Reactive "now" tick so the header's typing label disappears the moment
  // its expiry passes, even without a new event. Only ticks while at least
  // one chat is active.
  const nowMs = ref(Date.now())
  let tickHandle: ReturnType<typeof setInterval> | null = null
  function ensureTick() {
    if (tickHandle) return
    tickHandle = setInterval(() => {
      nowMs.value = Date.now()
      // Garbage-collect expired entries so the object doesn't grow forever.
      const active: Record<string, ChatActionEntry> = {}
      let changed = false
      for (const [id, e] of Object.entries(chatActions.value)) {
        if (e.until > nowMs.value) active[id] = e
        else changed = true
      }
      if (changed) chatActions.value = active
      if (Object.keys(active).length === 0) {
        clearInterval(tickHandle!)
        tickHandle = null
      }
    }, 1000)
  }

  function handleChatAction(payload: { chatId: string; action: string }) {
    if (payload.action === 'cancel') {
      const { [payload.chatId]: _, ...rest } = chatActions.value
      chatActions.value = rest
      return
    }
    chatActions.value = {
      ...chatActions.value,
      [payload.chatId]: { action: payload.action, until: Date.now() + 6000 },
    }
    ensureTick()
  }

  /** Live typing/uploading action for a chat, expiring with `nowMs`. */
  function actionFor(chatId: string | null | undefined): string | null {
    if (!chatId) return null
    const entry = chatActions.value[chatId]
    if (!entry) return null
    if (entry.until <= nowMs.value) return null
    return entry.action
  }

  return {
    chats, activeChat, messages, totalUnread,
    setChats, appendChats, setActiveChat, markActiveChatRead,
    handleNewMessage, handleChatUpdated, handleNewChat,
    handleMessageEdited, handleMessagesDeleted, handleMessageStatus,
    handleOutboxRead, handleChatAction, actionFor,
    addMessage, prependMessages, mergeMessages,
  }
})
