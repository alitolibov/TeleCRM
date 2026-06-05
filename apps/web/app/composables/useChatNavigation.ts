/**
 * Cross-component signal for "open this chat now". Used by notification clicks
 * (toast in app.vue, bell in default.vue, service worker via URL) — these
 * fire from outside the chat page and may target a chat that's already the
 * active one, in which case `route.query.chat` doesn't change and the
 * standard router watcher on the page no-ops.
 *
 * The page watches `pendingOpen` and reacts every time it bumps — including
 * to the chat it already has open (it'll re-fetch, then scroll to bottom).
 */
const pendingOpen = ref<{ chatId: string; ts: number } | null>(null)

export function useChatNavigation() {
  function requestOpen(chatId: string) {
    pendingOpen.value = { chatId, ts: Date.now() }
  }
  return { pendingOpen, requestOpen }
}
