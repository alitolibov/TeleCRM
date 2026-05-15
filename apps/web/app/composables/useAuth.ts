export function useAuth() {
  const store = useAuthStore()
  const config = useRuntimeConfig()
  const base = config.public.apiUrl as string

  async function login(username: string, password: string) {
    const data = await $fetch<{ accessToken: string; user: any }>(`${base}/auth/login`, {
      method: 'POST',
      body: { username, password },
      credentials: 'include',
    })
    store.setToken(data.accessToken)
    store.setUser(data.user)
  }

  async function refresh() {
    try {
      const data = await $fetch<{ accessToken: string; user: any }>(`${base}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      store.setToken(data.accessToken)
      store.setUser(data.user)
      return true
    } catch {
      store.clear()
      return false
    }
  }

  async function logout() {
    try {
      await $fetch(`${base}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: store.getToken() ? { Authorization: `Bearer ${store.getToken()}` } : {},
      })
    } finally {
      store.clear()
      navigateTo('/login')
    }
  }

  return {
    user: computed(() => store.user),
    getToken: store.getToken,
    login,
    refresh,
    logout,
  }
}
