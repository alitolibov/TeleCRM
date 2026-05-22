import type { AppUser } from '~/stores/users'

export interface EmployeeWithStats extends AppUser {
  activeChats: number
}

export interface EmployeeCreate {
  username: string
  password: string
  firstName: string
  lastName?: string
  role: 'admin' | 'manager'
}

export interface EmployeeUpdate {
  firstName?: string
  lastName?: string
  role?: 'admin' | 'manager'
  password?: string
}

/**
 * Admin-only CRUD for the /employees page.
 * Real-time status updates flow through useUsersStore via WS `user:status`.
 */
export function useEmployees() {
  const { api } = useApi()
  const list = ref<EmployeeWithStats[]>([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      list.value = await api<EmployeeWithStats[]>('/users/with-stats')
    } finally {
      loading.value = false
    }
  }

  async function create(payload: EmployeeCreate): Promise<AppUser> {
    const u = await api<AppUser>('/users', { method: 'POST', body: payload })
    await load()
    return u
  }

  async function update(id: string, payload: EmployeeUpdate): Promise<AppUser> {
    const u = await api<AppUser>(`/users/${id}`, { method: 'PATCH', body: payload })
    await load()
    return u
  }

  async function remove(id: string): Promise<void> {
    await api(`/users/${id}`, { method: 'DELETE' })
    await load()
  }

  /** Apply real-time status flip from WS without refetching the whole list. */
  function applyStatus(payload: { id: string; status: 'online' | 'offline'; lastSeenAt: string | null }) {
    const idx = list.value.findIndex(u => u.id === payload.id)
    if (idx !== -1) {
      list.value[idx] = { ...list.value[idx], status: payload.status, lastSeenAt: payload.lastSeenAt } as EmployeeWithStats
    }
  }

  return { list, loading, load, create, update, remove, applyStatus }
}
