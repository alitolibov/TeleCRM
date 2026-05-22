import type { AppUser } from '~/stores/users'

const HEARTBEAT_INTERVAL_MS = 30 * 1000

/**
 * Owns the "I am online" lifecycle:
 *  - sends a `heartbeat` over the existing socket every 30 s while the tab is open
 *  - exposes `setStatus(online|offline)` for the toggle in the UI
 *  - subscribes to `user:status` WS events to keep the store in sync
 *
 * The actual "auto-offline after 5 min" is enforced on the server (sweeper) —
 * the client just stops heartbeating when the tab closes.
 */
export function useUserStatus() {
  const { api } = useApi()
  const { on, off, emit } = useSocket()
  const store = useUsersStore()

  let timer: ReturnType<typeof setInterval> | null = null

  async function loadMe(): Promise<AppUser | null> {
    try {
      const u = await api<AppUser>('/users/me')
      store.setMe(u)
      return u
    } catch {
      store.setMe(null)
      return null
    }
  }

  async function loadAll(): Promise<void> {
    try {
      const list = await api<AppUser[]>('/users')
      store.setAll(list)
    } catch {
      store.setAll([])
    }
  }

  async function setStatus(status: 'online' | 'offline'): Promise<void> {
    const updated = await api<{ id: string; status: 'online' | 'offline'; lastSeenAt: string | null }>(
      '/users/me/status',
      { method: 'PATCH', body: { status } },
    )
    store.handleStatus(updated)
  }

  function ping() {
    console.log('[heartbeat] ping')
    emit('heartbeat')
  }

  function startHeartbeat() {
    if (timer) return
    // First ping after `connect` fires (socket.io buffers emits pre-connect,
    // but we log on each tick so we can verify the loop is running).
    const onConnect = () => {
      console.log('[heartbeat] socket connected — starting loop')
      ping()
    }
    on('connect', onConnect)
    // Defensive: if socket is already connected by the time we get here, fire now.
    ping()
    timer = setInterval(ping, HEARTBEAT_INTERVAL_MS)
  }

  function stopHeartbeat() {
    if (timer) clearInterval(timer)
    timer = null
  }

  /** Wire up WS subscription + heartbeat loop for the page lifetime. */
  function setupRealtime() {
    const onStatus = (payload: any) => store.handleStatus(payload)
    on('user:status', onStatus)
    startHeartbeat()
    onUnmounted(() => {
      off('user:status', onStatus)
      stopHeartbeat()
    })
  }

  return { loadMe, loadAll, setStatus, setupRealtime, startHeartbeat, stopHeartbeat }
}
