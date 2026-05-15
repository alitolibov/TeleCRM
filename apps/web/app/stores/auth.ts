interface AuthUser {
  id: string
  role: 'admin' | 'manager'
  username: string
  firstName: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const _token = ref('')

  const getToken = () => _token.value
  const setToken = (t: string) => { _token.value = t }
  const setUser = (u: AuthUser | null) => { user.value = u }
  const clear = () => { user.value = null; _token.value = '' }

  return { user, getToken, setToken, setUser, clear }
})

export type { AuthUser }
