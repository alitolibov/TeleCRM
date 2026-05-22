import { useQuery, useMutation } from '@tanstack/vue-query'
import { storeToRefs } from 'pinia'
import type { Chat, ChatMessage, ChatClient } from '~/stores/chats'

export type ClientStatus = 'thinking' | 'consulting' | 'waiting_price' | 'booked' | 'bought'

export interface ClosePayload {
  status: ClientStatus
  flightFrom?: string
  flightTo?: string
  dates?: string
  amount?: number
  comment?: string
}

export type TimelineItem =
  | { type: 'closed'; date: string; clientStatus: ClientStatus; flight: string | null; amount: string | null; dates: string | null }
  | { type: 'reopened'; date: string; trigger?: string }
  | { type: 'first_contact'; date: string }

export interface ClientInfo {
  client: ChatClient & { phone?: string | null; createdAt: string }
  assignedUser?: { id: string; firstName: string; username?: string } | null
  totalDialogs: number
  firstContactAt: string
  latestStatus: ClientStatus | null
  currentChatResult: {
    clientStatus: ClientStatus
    flight: string | null
    dates: string | null
    amount: string | null
    comment: string | null
  } | null
  timeline: TimelineItem[]
}

export function useChats() {
  const { api } = useApi()
  const store = useChatsStore()
  const { chats, activeChat, messages } = storeToRefs(store)
  const { on, off, emit } = useSocket()

  const { isLoading: loading } = useQuery({
    queryKey: ['chats'],
    queryFn: async () => {
      const data = await api<Chat[]>('/chats')
      store.setChats(data)
      return data
    },
  })

  async function openChat(id: string) {
    const chat = await api<Chat>(`/chats/${id}`)
    store.setActiveChat(chat)
    emit('join:chat', id)
    await api(`/chats/${id}/read`, { method: 'PATCH' }).catch(() => {})
    store.markActiveChatRead()
  }

  /**
   * Scroll-up pagination — fetches messages older than what's currently loaded.
   * Pulls from DB only (no Telegram backfill): all messages flow in via real-time
   * starting from the moment the chat is created in CRM.
   */
  async function loadOlder(chatId: string): Promise<number> {
    const oldest = store.messages[0]
    if (!oldest) return 0
    try {
      const older = await api<ChatMessage[]>(
        `/chats/${chatId}/messages?before=${encodeURIComponent(oldest.createdAt)}`,
      )
      // getMessages returns DESC, we want ascending in the array
      return store.prependMessages(older.reverse())
    } catch {
      return 0
    }
  }

  const sendMutation = useMutation({
    mutationFn: ({ chatId, text, replyTo }: { chatId: string; text: string; replyTo?: string }) =>
      api<ChatMessage>(`/chats/${chatId}/messages`, { method: 'POST', body: { text, replyTo } }),
    onSuccess: (msg) => { store.addMessage(msg) },
  })

  const assignMutation = useMutation({
    mutationFn: (chatId: string) => api<Chat>(`/chats/${chatId}/assign`, { method: 'PATCH' }),
    onSuccess: (chat) => { store.handleChatUpdated(chat) },
  })

  const closeMutation = useMutation({
    mutationFn: (payload: { chatId: string; data: ClosePayload }) =>
      api<Chat>(`/chats/${payload.chatId}/close`, { method: 'PATCH', body: payload.data }),
    onSuccess: (chat) => { store.handleChatUpdated(chat) },
  })

  const reopenMutation = useMutation({
    mutationFn: (chatId: string) =>
      api<Chat>(`/chats/${chatId}/reopen`, { method: 'PATCH' }),
    onSuccess: (chat) => { store.handleChatUpdated(chat) },
  })

  const editMessageMutation = useMutation({
    mutationFn: (p: { chatId: string; messageId: string; text: string }) =>
      api<ChatMessage>(`/chats/${p.chatId}/messages/${p.messageId}`, {
        method: 'PATCH',
        body: { text: p.text },
      }),
    onSuccess: (msg) => {
      store.handleMessageEdited({
        id: msg.id,
        chatId: msg.chatId,
        content: msg.content,
        editedAt: msg.editedAt ?? new Date().toISOString(),
      })
    },
  })

  const deleteMessageMutation = useMutation({
    mutationFn: (p: { chatId: string; messageId: string }) =>
      api(`/chats/${p.chatId}/messages/${p.messageId}`, { method: 'DELETE' }),
    onSuccess: (_data, vars) => {
      store.handleMessagesDeleted({ ids: [vars.messageId] })
    },
  })

  function loadClientInfo(chatId: string) {
    return api<ClientInfo>(`/chats/${chatId}/info`)
  }

  function sendMessage(text: string, replyTo?: string) {
    if (!store.activeChat) return
    return sendMutation.mutateAsync({ chatId: store.activeChat.id, text, replyTo })
  }

  function setupRealtime() {
    let readSyncTimer: ReturnType<typeof setTimeout> | null = null

    const onNewMessage = (msg: ChatMessage & { client: ChatClient }) => {
      store.handleNewMessage(msg)

      // If a client message arrived for the chat we're currently viewing,
      // tell the backend (and Telegram) we've seen it. Debounced so a burst
      // of messages only triggers one read receipt round-trip.
      if (
        msg.senderType === 'client' &&
        store.activeChat?.id === msg.chatId
      ) {
        if (readSyncTimer) clearTimeout(readSyncTimer)
        readSyncTimer = setTimeout(() => {
          api(`/chats/${msg.chatId}/read`, { method: 'PATCH' }).catch(() => {})
        }, 500)
      }
    }

    const onChatUpdated = (data: any) => store.handleChatUpdated(data)
    const onNewChat = (chat: Chat) => store.handleNewChat(chat)
    const onMessageEdited = (payload: any) => store.handleMessageEdited(payload)
    const onMessagesDeleted = (payload: any) => store.handleMessagesDeleted(payload)

    on('message:new', onNewMessage)
    on('chat:updated', onChatUpdated)
    on('chat:new', onNewChat)
    on('message:edited', onMessageEdited)
    on('message:deleted', onMessagesDeleted)

    onUnmounted(() => {
      if (readSyncTimer) clearTimeout(readSyncTimer)
      off('message:new', onNewMessage)
      off('chat:updated', onChatUpdated)
      off('chat:new', onNewChat)
      off('message:edited', onMessageEdited)
      off('message:deleted', onMessagesDeleted)
    })
  }

  function editMessage(messageId: string, text: string) {
    if (!store.activeChat) return
    return editMessageMutation.mutateAsync({ chatId: store.activeChat.id, messageId, text })
  }

  function deleteMessage(messageId: string) {
    if (!store.activeChat) return
    return deleteMessageMutation.mutateAsync({ chatId: store.activeChat.id, messageId })
  }

  return {
    chats,
    activeChat,
    messages,
    loading,
    openChat,
    loadOlder,
    sendMessage,
    editMessage,
    deleteMessage,
    assignChat: assignMutation.mutateAsync,
    closeChat: closeMutation.mutateAsync,
    reopenChat: reopenMutation.mutateAsync,
    loadClientInfo,
    setupRealtime,
  }
}
