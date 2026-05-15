export function useApi() {
  const store = useAuthStore()
  const config = useRuntimeConfig()
  const base = config.public.apiUrl as string

  async function api<T>(path: string, options: Parameters<typeof $fetch>[1] = {}): Promise<T> {
    const token = store.getToken()
    try {
      return await $fetch<T>(`${base}${path}`, {
        ...options,
        credentials: 'include',
        headers: {
          ...(options.headers as Record<string, string>),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
    } catch (err: any) {
      if (err?.status === 401) {
        try {
          const data = await $fetch<{ accessToken: string; user: any }>(`${base}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
          })
          store.setToken(data.accessToken)
          store.setUser(data.user)
          return api<T>(path, options)
        } catch {
          store.clear()
          navigateTo('/login')
        }
      }
      throw err
    }
  }

  return { api }
}
