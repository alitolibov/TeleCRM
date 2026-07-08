import type { Ref } from 'vue'

/**
 * Handles the message-list scroll behaviour:
 *  - tracks scroll-from-bottom for the floating "down" FAB
 *  - triggers backfill when nearing the top
 *  - auto-follows new messages if the user is already near the bottom
 */
export function useChatScroll(opts: {
  /** ID of the chat currently open (for backfill calls) */
  activeChatId: Ref<string | null>
  /** ID of the LAST message in the list — watched for genuinely new arrivals.
   *  We track the tail (not the count) so backfilling older history on scroll-up
   *  doesn't get mistaken for a new incoming message. */
  lastMessageId: Ref<string | null>
  /** Fetches older history; returns number of NEW messages added */
  loadOlder: (chatId: string) => Promise<number>
}) {
  const messagesEl = ref<HTMLElement>()
  const loadingOlder = ref(false)
  const historyExhausted = ref(false)
  const showScrollDown = ref(false)
  const newSinceUnscrolled = ref(0)

  function scrollToBottom(smooth = false) {
    const el = messagesEl.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    newSinceUnscrolled.value = 0
  }

  async function onScroll() {
    const el = messagesEl.value
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    showScrollDown.value = distanceFromBottom > 200
    if (distanceFromBottom < 80) newSinceUnscrolled.value = 0

    // Backfill when user reaches the top
    if (loadingOlder.value || historyExhausted.value || !opts.activeChatId.value) return
    if (el.scrollTop > 80) return

    // Wait for the initial message batch to land. An empty message list has
    // scrollTop=0 and scrollHeight<=clientHeight — indistinguishable from
    // "user scrolled all the way up in a fully loaded chat". Without this
    // guard, opening a chat via the optimistic path (messages briefly [])
    // fires backfill on empty state, loadOlder returns 0, and we latch
    // historyExhausted=true — scroll-up then never works for the session.
    if (el.scrollHeight <= el.clientHeight) return

    loadingOlder.value = true
    const prevHeight = el.scrollHeight
    try {
      const added = await opts.loadOlder(opts.activeChatId.value)
      if (added === 0) {
        historyExhausted.value = true
      } else {
        await nextTick()
        el.scrollTop = el.scrollHeight - prevHeight
      }
    } finally {
      loadingOlder.value = false
    }
  }

  // A genuinely new message appended at the BOTTOM changes the tail id. Backfill
  // (prepending older history) leaves the tail unchanged, so it won't trigger.
  // When near the bottom we auto-follow; otherwise bump the floating-FAB counter.
  watch(opts.lastMessageId, async (newId, oldId) => {
    if (!newId || newId === oldId) return
    await nextTick()
    const el = messagesEl.value
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 200) {
      scrollToBottom()
    } else {
      newSinceUnscrolled.value += 1
    }
  })

  /** Call from `openChat`/`selectChat`. Resets the history-exhausted flag. */
  function resetForChat() {
    historyExhausted.value = false
    newSinceUnscrolled.value = 0
  }

  return {
    messagesEl,
    loadingOlder,
    historyExhausted,
    showScrollDown,
    newSinceUnscrolled,
    onScroll,
    scrollToBottom,
    resetForChat,
  }
}
