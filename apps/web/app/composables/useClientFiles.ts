export interface ClientFileItem {
  id: string
  chatId: string
  content: {
    type: 'document'
    fileId: number
    remoteFileId?: string
    fileName: string
    mimeType: string
    size: number
    caption?: string
  }
  contentType: 'document'
  senderType: 'client' | 'manager' | 'system'
  createdAt: string
}

const PAGE = 50

/** Document attachments across all of the client's chats. Symmetric to
 *  useClientMedia — keyed on the currently open chat (the API resolves to
 *  clientId server-side) and paginated by created_at. */
export function useClientFiles() {
  const { api } = useApi()

  const items = ref<ClientFileItem[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const hasMore = ref(false)
  const loadedFor = ref<string | null>(null)

  async function load(chatId: string, force = false) {
    if (!chatId) return
    if (!force && loadedFor.value === chatId) return
    loading.value = true
    try {
      const rows = await api<ClientFileItem[]>(
        `/chats/${chatId}/files?limit=${PAGE}&offset=0`,
      )
      items.value = rows
      hasMore.value = rows.length === PAGE
      loadedFor.value = chatId
    } catch (e) {
      console.error('[client-files] load failed', e)
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
      const rows = await api<ClientFileItem[]>(
        `/chats/${chatId}/files?limit=${PAGE}&offset=${items.value.length}`,
      )
      const seen = new Set(items.value.map(m => m.id))
      const fresh = rows.filter(r => !seen.has(r.id))
      items.value = [...items.value, ...fresh]
      hasMore.value = rows.length === PAGE
    } catch (e) {
      console.error('[client-files] loadMore failed', e)
    } finally {
      loadingMore.value = false
    }
  }

  function reset() {
    items.value = []
    loadedFor.value = null
    hasMore.value = false
  }

  return { items, loading, loadingMore, hasMore, load, loadMore, reset }
}
