export interface AppUser {
  id: string
  username: string
  firstName: string
  lastName: string | null
  role: 'admin' | 'manager'
  status: 'online' | 'offline'
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export const useUsersStore = defineStore('users', () => {
  /** Currently authenticated user. */
  const me = ref<AppUser | null>(null)
  /** All employees (admins + managers) — populated for admin views and the transfer modal. */
  const all = ref<AppUser[]>([])

  function setMe(u: AppUser | null) { me.value = u }
  function setAll(users: AppUser[]) { all.value = users }

  /** Apply a `user:status` WS event — updates `me` and `all`. */
  function handleStatus(payload: { id: string; status: 'online' | 'offline'; lastSeenAt: string | null }) {
    if (me.value?.id === payload.id) {
      me.value = { ...me.value, status: payload.status, lastSeenAt: payload.lastSeenAt }
    }
    const idx = all.value.findIndex(u => u.id === payload.id)
    if (idx !== -1) {
      all.value[idx] = { ...all.value[idx], status: payload.status, lastSeenAt: payload.lastSeenAt } as AppUser
    }
  }

  return { me, all, setMe, setAll, handleStatus }
})
