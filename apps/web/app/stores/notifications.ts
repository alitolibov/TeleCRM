export type AppNotificationType = 'escalation' | 'transfer'

export interface AppNotification {
  id: string
  type: AppNotificationType
  title: string
  body: string
  chatId?: string
  level?: number
  createdAt: string
  read: boolean
}

const STORAGE_KEY = 'telecrm:notifications'
const MAX = 50

/**
 * In-app notification centre (the bell). Holds recent escalations and transfers
 * pushed over WS, so an employee can always see *why* they were pinged and jump
 * to the relevant chat — even after the transient toast is gone.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<AppNotification[]>([])

  const unreadCount = computed(() => items.value.filter(n => !n.read).length)

  function load() {
    if (!import.meta.client) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) items.value = JSON.parse(raw)
    } catch { /* ignore */ }
  }

  function persist() {
    if (!import.meta.client) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value)) } catch { /* ignore */ }
  }

  function add(n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) {
    const entry: AppNotification = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      read: false,
      ...n,
    }
    items.value = [entry, ...items.value].slice(0, MAX)
    persist()
    return entry
  }

  function markRead(id: string) {
    items.value = items.value.map(n => n.id === id ? { ...n, read: true } : n)
    persist()
  }

  function markAllRead() {
    items.value = items.value.map(n => ({ ...n, read: true }))
    persist()
  }

  function clear() {
    items.value = []
    persist()
  }

  return { items, unreadCount, load, add, markRead, markAllRead, clear }
})
