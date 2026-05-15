export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const store = useAuthStore()
  if (!store.user) {
    const { refresh } = useAuth()
    const ok = await refresh()
    if (!ok) return navigateTo('/login')
  }
})
