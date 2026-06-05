export interface CloseReason {
  id: string
  value: string
  label: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

// Module-level shared list — the close-chat dialog, the settings page, the
// results filter and the timeline labels all read from the same source.
const items = ref<CloseReason[]>([])
let loaded = false
let inFlight: Promise<void> | null = null

const bySort = (a: CloseReason, b: CloseReason) =>
  a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ru')

/** Admin-managed list of "close chat" outcomes. */
export function useCloseReasons() {
  const { api } = useApi()

  async function load(force = false) {
    if (loaded && !force) return
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        items.value = (await api<CloseReason[]>('/close-reasons')).sort(bySort)
        loaded = true
      } catch (e) {
        console.error('[close-reasons] load failed', e)
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  async function create(dto: { value: string; label: string; sortOrder?: number }) {
    const r = await api<CloseReason>('/close-reasons', { method: 'POST', body: dto })
    items.value = [...items.value, r].sort(bySort)
    return r
  }

  async function update(id: string, dto: { label?: string; sortOrder?: number }) {
    const r = await api<CloseReason>(`/close-reasons/${id}`, { method: 'PATCH', body: dto })
    items.value = items.value.map(x => (x.id === id ? r : x)).sort(bySort)
    return r
  }

  async function remove(id: string) {
    await api(`/close-reasons/${id}`, { method: 'DELETE' })
    items.value = items.value.filter(x => x.id !== id)
  }

  /** value → label, used by Results, ClientInfoSidebar, logs. */
  const labelOf = (value: string | null | undefined): string => {
    if (!value) return ''
    const r = items.value.find(x => x.value === value)
    return r?.label ?? value
  }

  return { items, load, create, update, remove, labelOf }
}
