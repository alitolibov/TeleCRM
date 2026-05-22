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
  /** Number of messages currently rendered — watched for new arrivals */
  messageCount: Ref<number>
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

  // Auto-follow on new messages when the user is near the bottom; otherwise
  // increment the unread-since-scroll counter on the floating FAB.
  watch(opts.messageCount, async (newLen, oldLen) => {
    if (newLen <= (oldLen ?? 0)) return
    await nextTick()
    const el = messagesEl.value
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 200) {
      scrollToBottom()
    } else {
      newSinceUnscrolled.value += newLen - (oldLen ?? 0)
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
