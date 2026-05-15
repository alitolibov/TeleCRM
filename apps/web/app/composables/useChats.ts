import { useQuery, useMutation } from '@tanstack/vue-query'
import { storeToRefs } from 'pinia'
import type { Chat, ChatMessage, ChatClient } from '~/stores/chats'

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

    void (async () => {
      // 1. Plug any holes between sparse DB messages — anchored at the NEWEST
      //    message we have, TDLib returns up to 50 immediately preceding it,
      //    fetching from server if needed. This recovers messages that the
      //    worker missed while offline (e.g. client wrote before manager replied).
      await backfillRecent(id)

      // 2. Make sure we have a decent amount of older history loaded so the
      //    user can immediately see context, without needing to scroll up.
      let attempts = 0
      while (store.messages.length < 30 && attempts < 3) {
        const added = await loadOlder(id)
        if (added === 0) break
        attempts++
      }
    })()
  }

  /**
   * Fetches messages immediately preceding our newest known message.
   * Used on chat open to fill gaps between sparse messages (typical when
   * the worker was offline during a back-and-forth).
   */
  async function backfillRecent(chatId: string): Promise<number> {
    const newest = store.messages[store.messages.length - 1]
    const before = newest?.telegramMessageId ?? 0
    try {
      const fetched = await api<ChatMessage[]>(
        `/chats/${chatId}/sync-history?before=${before}&limit=50`,
        { method: 'POST' },
      )
      return store.prependMessages(fetched)
    } catch {
      return 0
    }
  }

  /**
   * Loads OLDER messages for scroll-up pagination.
   * Anchored at the OLDEST message in our list.
   */
  async function loadOlder(chatId: string): Promise<number> {
    const oldest = store.messages[0]
    const before = oldest?.telegramMessageId ?? 0
    try {
      const fetched = await api<ChatMessage[]>(
        `/chats/${chatId}/sync-history?before=${before}&limit=50`,
        { method: 'POST' },
      )
      return store.prependMessages(fetched)
    } catch {
      return 0
    }
  }

  const sendMutation = useMutation({
    mutationFn: ({ chatId, text }: { chatId: string; text: string }) =>
      api<ChatMessage>(`/chats/${chatId}/messages`, { method: 'POST', body: { text } }),
    onSuccess: (msg) => { store.addMessage(msg) },
  })

  const assignMutation = useMutation({
    mutationFn: (chatId: string) => api<Chat>(`/chats/${chatId}/assign`, { method: 'PATCH' }),
    onSuccess: (chat) => { store.handleChatUpdated(chat) },
  })

  const closeMutation = useMutation({
    mutationFn: (chatId: string) => api<Chat>(`/chats/${chatId}/close`, { method: 'PATCH' }),
    onSuccess: (chat) => { store.handleChatUpdated(chat) },
  })

  function sendMessage(text: string) {
    if (!store.activeChat) return
    return sendMutation.mutateAsync({ chatId: store.activeChat.id, text })
  }

  function setupRealtime() {
    const onNewMessage = (msg: ChatMessage & { client: ChatClient }) => store.handleNewMessage(msg)
    const onChatUpdated = (data: any) => store.handleChatUpdated(data)
    const onNewChat = (chat: Chat) => store.handleNewChat(chat)

    on('message:new', onNewMessage)
    on('chat:updated', onChatUpdated)
    on('chat:new', onNewChat)

    onUnmounted(() => {
      off('message:new', onNewMessage)
      off('chat:updated', onChatUpdated)
      off('chat:new', onNewChat)
    })
  }

  return {
    chats,
    activeChat,
    messages,
    loading,
    openChat,
    loadOlder,
    sendMessage,
    assignChat: assignMutation.mutateAsync,
    closeChat: closeMutation.mutateAsync,
    setupRealtime,
  }
}
