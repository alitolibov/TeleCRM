export interface ChatClient {
  id: string
  telegramId: number
  firstName: string
  lastName?: string
  username?: string
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
  createdAt: string
  editedAt?: string | null
  replyToTgId?: number | null
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
    const merged = { ...data, ...overrides }
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

  return {
    chats, activeChat, messages, totalUnread,
    setChats, setActiveChat, markActiveChatRead,
    handleNewMessage, handleChatUpdated, handleNewChat,
    handleMessageEdited, handleMessagesDeleted,
    addMessage, prependMessages,
  }
})
