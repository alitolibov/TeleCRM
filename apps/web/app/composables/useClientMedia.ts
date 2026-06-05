export interface ClientMediaItem {
  id: string
  chatId: string
  content: {
    type: 'photo' | 'video'
    fileId: number
    remoteFileId?: string
    caption?: string
    width?: number
    height?: number
    duration?: number
  }
  contentType: 'photo' | 'video'
  senderType: 'client' | 'manager' | 'system'
  createdAt: string
}

const PAGE = 60

/** Loads photo/video messages across all of the client's chats (keyed by the
 *  currently open chat — the API resolves to clientId server-side). */
export function useClientMedia() {
  const { api } = useApi()

  const items = ref<ClientMediaItem[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const hasMore = ref(false)
  const loadedFor = ref<string | null>(null)

  async function load(chatId: string, force = false) {
    if (!chatId) return
    if (!force && loadedFor.value === chatId) return
    loading.value = true
    try {
      const rows = await api<ClientMediaItem[]>(
        `/chats/${chatId}/media?limit=${PAGE}&offset=0`,
      )
      items.value = rows
      hasMore.value = rows.length === PAGE
      loadedFor.value = chatId
    } catch (e) {
      console.error('[client-media] load failed', e)
      items.value = []
      hasMore.value = false
    } finally {
      loading.value = false
    }
  }

  async function loadMore(chatId: string) {
    if (!chatId || loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const rows = await api<ClientMediaItem[]>(
        `/chats/${chatId}/media?limit=${PAGE}&offset=${items.value.length}`,
      )
      const seen = new Set(items.value.map(m => m.id))
      const fresh = rows.filter(r => !seen.has(r.id))
      items.value = [...items.value, ...fresh]
      hasMore.value = rows.length === PAGE
    } catch (e) {
      console.error('[client-media] loadMore failed', e)
    } finally {
      loadingMore.value = false
    }
  }

  /** Optimistically add a newly-arrived media message to the top of the grid
   *  so the tab feels live while it's open. */
  function prepend(msg: ClientMediaItem) {
    if (items.value.some(m => m.id === msg.id)) return
    items.value = [msg, ...items.value]
  }

  function reset() {
    items.value = []
    loadedFor.value = null
    hasMore.value = false
  }

  return { items, loading, loadingMore, hasMore, load, loadMore, prepend, reset }
}
