export interface QuickReply {
  id: string
  name: string
  body: string
  createdAt: string
  updatedAt: string
}

// Module-level shared list so the composer and the settings page stay in sync.
const items = ref<QuickReply[]>([])
let loaded = false

const byName = (a: QuickReply, b: QuickReply) => a.name.localeCompare(b.name, 'ru')

/** Personal quick-reply templates (spec 19). */
export function useQuickReplies() {
  const { api } = useApi()

  async function load(force = false) {
    if (loaded && !force) return
    loaded = true
    try {
      items.value = (await api<QuickReply[]>('/quick-replies')).sort(byName)
    } catch (e) {
      loaded = false
      console.error('[quick-replies] load failed', e)
    }
  }

  async function create(dto: { name: string; body: string }) {
    const r = await api<QuickReply>('/quick-replies', { method: 'POST', body: dto })
    items.value = [...items.value, r].sort(byName)
    return r
  }

  async function update(id: string, dto: { name?: string; body?: string }) {
    const r = await api<QuickReply>(`/quick-replies/${id}`, { method: 'PATCH', body: dto })
    items.value = items.value.map(x => (x.id === id ? r : x)).sort(byName)
    return r
  }

  async function remove(id: string) {
    await api(`/quick-replies/${id}`, { method: 'DELETE' })
    items.value = items.value.filter(x => x.id !== id)
  }

  return { items, load, create, update, remove }
}
