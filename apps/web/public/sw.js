/* TeleCRM service worker — browser push notifications (spec 10.1). */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }

  const title = data.title || 'TeleCRM'
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,        // collapse repeats per conversation
    renotify: !!data.tag,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { chatId: data.chatId || null },
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // If a CRM window is already focused, the user is looking at the app —
      // the in-app sound/badge cover it, so don't show a redundant OS toast.
      const focused = clients.some((c) => c.focused && c.visibilityState === 'visible')
      if (focused) return
      return self.registration.showNotification(title, options)
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const chatId = event.notification.data && event.notification.data.chatId
  const url = chatId ? `/?chat=${chatId}` : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab if we have one; otherwise open a fresh one.
      const existing = clients.find((c) => 'focus' in c)
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    }),
  )
})
