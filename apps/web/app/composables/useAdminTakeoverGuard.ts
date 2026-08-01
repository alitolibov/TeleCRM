import type { Chat } from '~/stores/chats'
import { FAVORITES_CHAT_ID } from '~/composables/useFavorites'

/**
 * Wraps actions that an admin might perform on a chat owned by another manager
 * (send, edit, delete, close, reopen). On confirm, the chat is reassigned to
 * the admin IMMEDIATELY (via `onTakeover`) — so the chat-list badge flips right
 * away, even when the underlying action (e.g. open edit mode) is local-only.
 */
export function useAdminTakeoverGuard(opts?: {
  onTakeover?: (chatId: string) => Promise<unknown>
}) {
  const { user } = useAuth()

  const guardDialog = ref<{
    open: boolean
    chatId: string | null
    ownerName: string
    actionLabel: string
    onConfirm: (() => Promise<void> | void) | null
  }>({ open: false, chatId: null, ownerName: '', actionLabel: '', onConfirm: null })

  /**
   * True if running `action` on this chat would change its ownership for admin:
   *  - chat has no owner (any status except 'new', which has its own TakeChatDialog
   *    on the send path) → admin would auto-claim it
   *  - chat is owned by another manager → admin would take it over
   */
  function needsConfirmation(chat: Chat | null | undefined): boolean {
    if (!chat || !user.value) return false
    // "Избранное" is a synthetic, private, per-user chat — there is nothing to
    // own or take over. Without this it trips the "no owner" branch below and
    // asks the admin to claim their own notes.
    if (chat.id === FAVORITES_CHAT_ID) return false
    if (user.value.role !== 'admin') return false
    if (!chat.assignedUser) {
      // `new` chats are claimed via the existing TakeChatDialog on sendMessage.
      // For any other status without owner (anomaly), show this modal.
      return chat.status !== 'new'
    }
    return chat.assignedUser.id !== user.value.id
  }

  /**
   * Run `action`. If a takeover is required, open the confirm modal first;
   * caller's action only fires after the user confirms.
   *
   * @param actionLabel — human label for the modal ("отправить сообщение",
   *   "изменить сообщение", "удалить сообщение", "закрыть чат", "переоткрыть чат")
   */
  function withGuard(
    chat: Chat | null | undefined,
    actionLabel: string,
    action: () => Promise<void> | void,
  ) {
    if (!needsConfirmation(chat)) {
      Promise.resolve(action()).catch((e) => console.error(e))
      return
    }
    guardDialog.value = {
      open: true,
      chatId: chat!.id,
      // Empty ownerName signals "claim" (no current owner) — modal copy switches.
      ownerName: chat!.assignedUser?.firstName ?? '',
      actionLabel,
      onConfirm: action,
    }
  }

  async function confirm() {
    const action = guardDialog.value.onConfirm
    const chatId = guardDialog.value.chatId
    guardDialog.value = { open: false, chatId: null, ownerName: '', actionLabel: '', onConfirm: null }

    // First — reassign the chat to current user via the provided callback.
    // This fires the API call + WS chat:updated, so the badge flips immediately
    // without waiting for the action below to reach the backend.
    if (chatId && opts?.onTakeover) {
      try { await opts.onTakeover(chatId) } catch (e) { console.error('[takeover] failed:', e) }
    }
    // Then proceed with the user's intended action (open edit mode, delete confirm dialog, …)
    if (action) await Promise.resolve(action()).catch((e) => console.error(e))
  }

  function cancel() {
    guardDialog.value = { open: false, chatId: null, ownerName: '', actionLabel: '', onConfirm: null }
  }

  return { guardDialog, withGuard, confirm, cancel, needsConfirmation }
}
