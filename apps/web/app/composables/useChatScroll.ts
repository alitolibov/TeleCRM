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

  /**
   * "Pinned to the latest message" mode. The one-shot scrollToBottom on chat
   * open fires after nextTick — when the DOM exists but images/videos haven't
   * loaded yet. Media without reserved height then grows the content and the
   * viewport ends up stranded mid-history. While this flag is on, every late
   * media load re-pins the scroll to the bottom; any real scroll away from
   * the bottom (in onScroll) switches it off, so reading history is never
   * yanked around.
   */
  const stickToBottom = ref(true)

  function scrollToBottom(smooth = false) {
    const el = messagesEl.value
    if (!el) return
    stickToBottom.value = true
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    newSinceUnscrolled.value = 0
  }

  // <img>/<video> load events don't bubble, but they ARE observable on an
  // ancestor in the capture phase — one pair of listeners on the scroll
  // container catches every media element inside it, present and future.
  function onMediaSettled() {
    const el = messagesEl.value
    if (!el || !stickToBottom.value) return
    el.scrollTop = el.scrollHeight
  }
  watch(messagesEl, (el, prev) => {
    if (prev) {
      prev.removeEventListener('load', onMediaSettled, true)
      prev.removeEventListener('loadedmetadata', onMediaSettled, true)
    }
    if (el) {
      el.addEventListener('load', onMediaSettled, true)
      el.addEventListener('loadedmetadata', onMediaSettled, true)
    }
  })
  onUnmounted(() => {
    const el = messagesEl.value
    if (el) {
      el.removeEventListener('load', onMediaSettled, true)
      el.removeEventListener('loadedmetadata', onMediaSettled, true)
    }
  })

  async function onScroll() {
    const el = messagesEl.value
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    showScrollDown.value = distanceFromBottom > 200
    // Track stickiness off the user's actual position: scrolled away → stop
    // re-pinning on media loads; back at the bottom → resume following.
    stickToBottom.value = distanceFromBottom < 80
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
    // A fresh chat always opens at the latest message — pin immediately so
    // media that loads during the initial render already re-anchors, without
    // waiting for the explicit scrollToBottom that follows.
    stickToBottom.value = true
  }

  return {
    messagesEl,
    loadingOlder,
    historyExhausted,
    showScrollDown,
    newSinceUnscrolled,
    stickToBottom,
    onScroll,
    scrollToBottom,
    resetForChat,
  }
}
