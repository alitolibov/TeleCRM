import type { ChatMessage } from '~/stores/chats'

export const FAVORITES_CHAT_ID = 'favorites'

interface FavoriteRow {
  id: string
  userId: string
  content: any
  source: any | null
  createdAt: string
}

// Module-level so the list survives navigation between chats — favorites stay
// loaded in the background and re-render instantly when reopened.
const items = ref<ChatMessage[]>([])
const loaded = ref(false)
const loading = ref(false)

/**
 * Personal "Saved Messages" store — text notes + (later, via the forward
 * action) snapshots of client messages. The shape is mapped to `ChatMessage`
 * up front so the existing `MessageBubble` component renders them verbatim.
 */
export function useFavorites() {
  const { api } = useApi()
  const auth = useAuthStore()

  /** Map a server-side favorite row into the ChatMessage shape MessageBubble expects. */
  function toMessage(row: FavoriteRow): ChatMessage {
    const msg: ChatMessage = {
      id: row.id,
      chatId: FAVORITES_CHAT_ID,
      telegramMessageId: 0,
      senderType: 'manager',
      senderId: auth.user?.id ?? null,
      contentType: row.content?.type ?? 'text',
      content: row.content,
      isRead: true,
      createdAt: row.createdAt,
    }
    if (row.source) {
      msg.forwardedFrom = {
        name: row.source.clientName,
        sentAt: row.source.sentAt,
      }
    }
    return msg
  }

  async function load() {
    if (loading.value) return
    loading.value = true
    try {
      const rows = await api<FavoriteRow[]>(`/favorites`)
      // Server returns newest-first; the UI renders oldest-first like a chat.
      items.value = rows.map(toMessage).reverse()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  async function add(text: string, replyToId?: string) {
    const row = await api<FavoriteRow>(`/favorites`, {
      method: 'POST',
      body: replyToId ? { text, replyToId } : { text },
    })
    items.value = [...items.value, toMessage(row)]
  }

  /** Multipart upload — one favorite row per file. Caption (if any) lands on
   *  the first file so it shows under the first photo, matching chat UX. */
  async function upload(files: File[], caption?: string, replyToId?: string) {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    if (caption) form.append('caption', caption)
    if (replyToId) form.append('replyToId', replyToId)
    const rows = await api<FavoriteRow[]>(`/favorites/upload`, { method: 'POST', body: form })
    // Server returns insertion order (oldest-first within this batch) which is
    // exactly the visual order we want at the bottom.
    items.value = [...items.value, ...rows.map(toMessage)]
  }

  async function remove(id: string) {
    await api(`/favorites/${id}`, { method: 'DELETE' })
    items.value = items.value.filter(m => m.id !== id)
  }

  async function clear() {
    await api(`/favorites/clear`, { method: 'DELETE' })
    items.value = []
  }

  return { items, loaded, loading, load, add, upload, remove, clear }
}
