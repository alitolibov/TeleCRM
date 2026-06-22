import { useMutation } from '@tanstack/vue-query'
import { storeToRefs } from 'pinia'
import type { Chat, ChatMessage, ChatClient } from '~/stores/chats'
import { FAVORITES_CHAT_ID } from '~/composables/useFavorites'

export interface ChatListFilters {
  status: '' | 'new' | 'active' | 'closed'
  assignedTo: string          // '' = all, 'unassigned', or a manager uuid (admin only)
  dateFrom: string            // ISO; filter by last-message date (spec 5.2)
  dateTo: string
  q: string
}

interface ChatPage { items: Chat[]; nextCursor: string | null }

/** Machine key from close_reasons.value — admin-managed, not a fixed enum. */
export type ClientStatus = string

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
  | { type: 'taken'; date: string }
  | { type: 'transferred'; date: string; fromName: string | null; toName: string | null; comment: string | null; mode: 'reassign' | 'queue' }
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

// Latest chat the user asked to open, shared across every useChats() caller.
// openChat() applies the fetched payload only if this still matches — see the
// note in openChat for why this can't key off store.activeChat.
let lastRequestedChatId: string | null = null

export function useChats() {
  const { api } = useApi()
  const store = useChatsStore()
  const { chats, activeChat, messages } = storeToRefs(store)
  const { on, off, emit } = useSocket()
  const sound = useNotificationSound()

  // === Paginated, filterable chat list (spec 5.1–5.2) ===
  const loading = ref(true)
  const loadingMore = ref(false)
  const nextCursor = ref<string | null>(null)
  const hasMore = computed(() => nextCursor.value !== null)

  const filters = reactive<ChatListFilters>({
    status: '', assignedTo: '', dateFrom: '', dateTo: '', q: '',
  })

  function buildListQuery(cursor?: string | null): string {
    // Page size — 20 fits roughly one viewport on a typical sidebar; scroll
    // near the bottom auto-loads the next 20 via `loadMoreChats`.
    const p = new URLSearchParams({ limit: '20' })
    if (cursor) p.set('cursor', cursor)
    if (filters.status) p.set('status', filters.status)
    if (filters.assignedTo) p.set('assignedTo', filters.assignedTo)
    if (filters.dateFrom) p.set('dateFrom', filters.dateFrom)
    if (filters.dateTo) p.set('dateTo', filters.dateTo)
    const q = filters.q.trim()
    if (q) p.set('q', q)
    return p.toString()
  }

  /** Shared structural-filter check: status, owner, date range. Used by
   *  both the partial and full predicates — those just differ in how
   *  they treat missing fields and the search query. */
  function passesStructural(c: Partial<Chat>): boolean {
    if (filters.status && c.status !== undefined && c.status !== filters.status) return false

    if (filters.assignedTo === 'unassigned') {
      if (c.assignedTo !== undefined && c.assignedTo !== null) return false
    } else if (filters.assignedTo) {
      if (c.assignedTo !== undefined && c.assignedTo !== filters.assignedTo) return false
    }

    if ((filters.dateFrom || filters.dateTo) && (c.lastMessageAt || c.createdAt)) {
      const ts = new Date(c.lastMessageAt ?? c.createdAt!).getTime()
      if (filters.dateFrom && ts < new Date(filters.dateFrom).getTime()) return false
      if (filters.dateTo && ts > new Date(filters.dateTo).getTime()) return false
    }

    return true
  }

  /** Cheap pre-fetch check on the partial WS payload. Returns false ONLY
   *  when a field IS present in the payload and contradicts the filter
   *  (e.g. assignedTo='ali' while filter='admin'). Lets us skip the
   *  `/chats/:id` GET during the auto-distribute burst that can fire
   *  100 chat:updated events back-to-back. */
  function partialMatchesFilter(c: Partial<Chat>): boolean {
    return passesStructural(c)
  }

  /** Full predicate for ADDING a chat to the visible list. Includes the
   *  search-query approximation (name/username only — server also matches
   *  message text, but we can't verify that client-side, so we'd rather
   *  miss-add than wrong-add. Genuine matches will appear on the next
   *  refetch, which loadChats already triggers when q changes). */
  function chatPassesFilterForAdd(c: Chat): boolean {
    if (!passesStructural(c)) return false
    const q = filters.q.trim().toLowerCase()
    if (q) {
      const haystack = [c.client?.firstName, c.client?.lastName, c.client?.username]
        .filter(Boolean).map(s => s!.toLowerCase())
      if (!haystack.some(h => h.includes(q))) return false
    }
    return true
  }

  /** Full predicate for KEEPING a known chat in the list after an update.
   *  Skips the q check on purpose — the chat is already in the list
   *  because the server vetted it, and we don't want a WS update with
   *  partial data (no message bodies) to remove it just because we can't
   *  re-verify the search match. */
  function chatPassesFilterForKeep(c: Chat): boolean {
    return passesStructural(c)
  }

  async function loadChats() {
    loading.value = true
    try {
      const res = await api<ChatPage>(`/chats?${buildListQuery()}`)
      store.setChats(res.items)
      nextCursor.value = res.nextCursor
    } catch (e) {
      console.error('[chats] load failed', e)
    } finally {
      loading.value = false
    }
  }

  async function loadMoreChats() {
    if (!nextCursor.value || loadingMore.value) return
    loadingMore.value = true
    try {
      const res = await api<ChatPage>(`/chats?${buildListQuery(nextCursor.value)}`)
      store.appendChats(res.items)
      nextCursor.value = res.nextCursor
    } catch (e) {
      console.error('[chats] load-more failed', e)
    } finally {
      loadingMore.value = false
    }
  }

  // Reload (back to page 1) when any filter/search changes — debounced so typing
  // in the search box doesn't fire a request per keystroke.
  let filterTimer: ReturnType<typeof setTimeout> | null = null
  watch(filters, () => {
    if (filterTimer) clearTimeout(filterTimer)
    filterTimer = setTimeout(loadChats, 300)
  }, { deep: true })

  // Initial load.
  loadChats()

  async function openChat(id: string) {
    lastRequestedChatId = id
    // Optimistic open: if we already have the chat in the list (typical:
    // user clicked it there), paint it instantly from cached data while
    // the full payload (messages, pinned, hasCrmContact, …) loads in the
    // background. Without this every click waited a full Hetzner round-
    // trip (~200 ms+) before anything visibly happened.
    const cached = store.chats.find((c) => c.id === id)
    if (cached) store.setActiveChat({ ...cached, messages: [] } as Chat)
    emit('join:chat', id)
    // Mark-read fires in parallel — UI shouldn't wait for it.
    api(`/chats/${id}/read`, { method: 'PATCH' }).then(
      () => { if (store.activeChat?.id === id) store.markActiveChatRead() },
      () => { /* ignore */ },
    )
    const chat = await api<Chat>(`/chats/${id}`)
    // Apply unless the user has since requested a different chat. We key off
    // lastRequestedChatId, NOT store.activeChat?.id: chats opened via deep-link
    // from /results or /contacts aren't in the sidebar list, so the optimistic
    // paint above never ran and activeChat is still null/previous — the old
    // `activeChat?.id === id` check silently dropped their payload and the chat
    // never opened.
    if (lastRequestedChatId === id) store.setActiveChat(chat)
  }

  /**
   * Scroll-up pagination. First serves older messages already in the DB; once
   * those are exhausted it backfills from Telegram (getChatHistory) so the
   * manager can see the full prior conversation — even messages from before the
   * client was ever in the CRM.
   */
  async function loadOlder(chatId: string): Promise<number> {
    // Favorites is a virtual chat — no server-side history pagination, the
    // useFavorites composable owns the list. Without this guard the scroll-up
    // handler sends `/chats/favorites/messages?...` and PG explodes on the
    // sentinel string vs uuid column.
    if (chatId === FAVORITES_CHAT_ID) return 0
    const oldest = store.messages[0]
    if (!oldest) return 0
    try {
      // 1. Older messages already stored locally.
      const older = await api<ChatMessage[]>(
        `/chats/${chatId}/messages?before=${encodeURIComponent(oldest.createdAt)}`,
      )
      if (older.length > 0) return store.prependMessages(older.reverse())

      // 2. DB exhausted → pull older history from Telegram (returns oldest→newest).
      const synced = await api<ChatMessage[]>(
        `/chats/${chatId}/sync-history?before=${oldest.telegramMessageId}&limit=50`,
        { method: 'POST' },
      )
      return store.prependMessages(synced)
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

  const transferMutation = useMutation({
    mutationFn: (p: { chatId: string; toUserId: string | null; comment: string }) =>
      api<Chat>(`/chats/${p.chatId}/transfer`, {
        method: 'PATCH',
        body: { toUserId: p.toUserId, comment: p.comment },
      }),
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

  /**
   * Defense-in-depth realtime: optimistic WS updates + multiple safety nets.
   * Layers:
   *  1. WS events           — immediate UI feedback for the happy path
   *  2. Reconnect refetch   — catch up after a network blip
   *  3. Visibility refetch  — catch up when user returns to the tab
   *  4. Background polling  — periodic full refresh (60 s) as last resort
   * Each layer is independent — if any one fails, the others compensate.
   */
  function setupRealtime() {
    let readSyncTimer: ReturnType<typeof setTimeout> | null = null
    let hasConnectedOnce = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    async function fullRefetch(reason: string) {
      console.log(`[realtime] full refetch — ${reason}`)
      try { await loadChats() } catch (e) { console.error(e) }
      const activeId = store.activeChat?.id
      // Favorites: skip the /chats refetch (virtual id); the per-user list is
      // small enough that a quiet reload-on-reopen is good enough.
      if (activeId && activeId !== FAVORITES_CHAT_ID) {
        try {
          const msgs = await api<ChatMessage[]>(`/chats/${activeId}/messages`)
          store.prependMessages(msgs)
        } catch (e) { console.error(e) }
      }
    }

    const onNewMessage = (msg: ChatMessage & { client: ChatClient }) => {
      console.log('[ws] ← message:new', { chatId: msg.chatId, type: msg.content?.type })
      store.handleNewMessage(msg)

      // Notification chime for every incoming client message (spec 10.1).
      if (msg.senderType === 'client') sound.play()

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

    const onChatUpdated = async (data: any) => {
      console.log('[ws] ← chat:updated', { id: data.id, fields: Object.keys(data) })
      const known = store.chats.some(c => c.id === data.id)

      // Apply the patch up-front no matter what — handleChatUpdated knows
      // how to refresh `activeChat` even when the chat isn't in the list
      // (user opened it via search). Without this the open chat's header
      // and badges go stale after WS updates.
      store.handleChatUpdated(data)

      if (!known) {
        // Chat wasn't in the loaded window. May be a new auto-assign, a
        // bumped-up off-page chat, or a tangential update (pin/online).
        // Cheap partial-data filter check first — when the WS payload
        // already contradicts the active filter (e.g. assignedTo='ali'
        // while we're viewing 'admin'), skip the GET entirely. This is
        // what was flooding the list during auto-distribute bursts.
        if (!partialMatchesFilter(data)) return
        try {
          const chat = await api<Chat>(`/chats/${data.id}`)
          // Server fields might disagree with the partial — recheck on full data.
          if (!chatPassesFilterForAdd(chat)) return
          store.handleNewChat(chat)
        } catch { /* ignore — surfaces on next reload/poll */ }
        return
      }

      // Known chat — the patch was applied above. Drop from the list if
      // the post-merge projection no longer matches the structural filter
      // (e.g. status flipped active → closed while filter='active').
      const updated = store.chats.find(c => c.id === data.id)
      if (updated && !chatPassesFilterForKeep(updated)) {
        store.dropChat(data.id)
      }
    }
    const onNewChat = (chat: Chat) => {
      console.log('[ws] ← chat:new', { id: chat.id })
      // A genuinely new chat might still not match the active filter —
      // e.g. it's 'new' status while we're viewing 'closed'. Skip cleanly.
      if (!chatPassesFilterForAdd(chat)) return
      store.handleNewChat(chat)
    }
    const onMessageEdited = (payload: any) => store.handleMessageEdited(payload)
    const onMessagesDeleted = (payload: any) => store.handleMessagesDeleted(payload)
    const onMessageStatus = (payload: any) => store.handleMessageStatus(payload)

    // Layer 2 — reconnect catch-up
    const onConnect = () => {
      if (!hasConnectedOnce) { hasConnectedOnce = true; return }
      fullRefetch('socket reconnected')
    }

    // Layer 3 — tab visibility catch-up
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fullRefetch('tab focused')
    }

    // Layer 4 — periodic background poll
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') fullRefetch('60s poll')
    }, 60_000)

    // Read receipts + typing — direct passthrough to the store, no extra
    // logic needed: the store owns the auto-expiry tick and the deep merge.
    const onOutboxRead = (p: { chatId: string; ids: string[]; readAt: string }) => {
      store.handleOutboxRead(p)
    }
    const onChatAction = (p: { chatId: string; action: string }) => {
      store.handleChatAction(p)
    }

    on('connect', onConnect)
    on('message:new', onNewMessage)
    on('chat:updated', onChatUpdated)
    on('chat:new', onNewChat)
    on('message:edited', onMessageEdited)
    on('message:deleted', onMessagesDeleted)
    on('message:status', onMessageStatus)
    on('chat:outbox-read', onOutboxRead)
    on('chat:action', onChatAction)
    document.addEventListener('visibilitychange', onVisibility)

    onUnmounted(() => {
      if (readSyncTimer) clearTimeout(readSyncTimer)
      if (pollTimer) clearInterval(pollTimer)
      off('connect', onConnect)
      off('message:new', onNewMessage)
      off('chat:updated', onChatUpdated)
      off('chat:new', onNewChat)
      off('message:edited', onMessageEdited)
      off('message:deleted', onMessagesDeleted)
      off('message:status', onMessageStatus)
      off('chat:outbox-read', onOutboxRead)
      off('chat:action', onChatAction)
      document.removeEventListener('visibilitychange', onVisibility)
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
    loadingMore,
    hasMore,
    filters,
    loadChats,
    loadMoreChats,
    openChat,
    loadOlder,
    sendMessage,
    editMessage,
    deleteMessage,
    assignChat: assignMutation.mutateAsync,
    closeChat: closeMutation.mutateAsync,
    reopenChat: reopenMutation.mutateAsync,
    transferChat: transferMutation.mutateAsync,
    loadClientInfo,
    setupRealtime,
  }
}
