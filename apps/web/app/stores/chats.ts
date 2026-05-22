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
  assignedUser?: { id: string; firstName: string; username: string } | null
  messages?: ChatMessage[]
  lastMessage?: ChatMessage | null
}

export const useChatsStore = defineStore('chats', () => {
  const chats = ref<Chat[]>([])
  const activeChat = ref<Chat | null>(null)
  const messages = ref<ChatMessage[]>([])

  const totalUnread = computed(() => chats.value.reduce((s, c) => s + (c.unreadCount ?? 0), 0))

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
    // If this chat is currently open, the manager is looking at it — never let
    // the unread counter creep above zero, even if a fresh message just landed.
    const isActive = activeChat.value?.id === data.id
    const overrides = isActive && data.unreadCount !== undefined ? { unreadCount: 0 } : {}
    const merged = { ...data, ...overrides }
    const idx = chats.value.findIndex(c => c.id === data.id)
    if (idx !== -1) chats.value[idx] = { ...chats.value[idx], ...merged } as Chat
    if (isActive) activeChat.value = { ...activeChat.value, ...merged } as Chat
  }

  function handleNewChat(chat: Chat) {
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
