import type { ChatMessage } from '~/stores/chats'

/**
 * Encapsulates message edit/delete UI state:
 *  - which message is being edited (composer prepopulates from it)
 *  - delete confirmation dialog
 *  - floating context menu (position + target)
 *
 * The actual server calls are owned by `useChats`. This composable only
 * orchestrates UI state and exposes openers/handlers for the page to wire up.
 */
export function useMessageActions(opts: {
  editMessage: (messageId: string, text: string) => Promise<unknown> | undefined
  deleteMessage: (messageId: string) => Promise<unknown> | undefined
}) {
  const editingMessageId = ref<string | null>(null)
  const editingMessage = ref<ChatMessage | null>(null)
  const editText = ref('')

  // Reply state — set when user picks "Ответить" in context menu
  const replyingTo = ref<ChatMessage | null>(null)

  const deleteDialog = ref<{ open: boolean; messageId: string | null }>({
    open: false,
    messageId: null,
  })

  const actionMenuPos = ref<{ x: number; y: number } | null>(null)
  const actionMenuMsg = ref<ChatMessage | null>(null)

  /** Editable = our outgoing text message OR media with a caption. */
  function canEdit(msg: ChatMessage): boolean {
    if (msg.senderType !== 'manager') return false
    return msg.content?.type === 'text' || 'caption' in (msg.content ?? {})
  }
  function canDelete(msg: ChatMessage): boolean {
    return msg.senderType === 'manager'
  }
  /** Reply works on any non-deleted message (own or client's). */
  function canReply(_msg: ChatMessage): boolean {
    return true
  }

  function startEditing(msg: ChatMessage) {
    editingMessageId.value = msg.id
    editingMessage.value = msg
    editText.value = msg.content?.type === 'text' ? (msg.content.text ?? '') : (msg.content?.caption ?? '')
    replyingTo.value = null      // editing + replying are mutually exclusive
    closeActionMenu()
  }

  function cancelEditing() {
    editingMessageId.value = null
    editingMessage.value = null
    editText.value = ''
  }

  function startReplying(msg: ChatMessage) {
    replyingTo.value = msg
    cancelEditing()              // can't reply while editing
    closeActionMenu()
  }

  function cancelReplying() {
    replyingTo.value = null
  }

  async function submitEdit(): Promise<boolean> {
    const id = editingMessageId.value
    const body = editText.value.trim()
    if (!id || !body) return false
    await opts.editMessage(id, body)
    cancelEditing()
    return true
  }

  function askDelete(msg: ChatMessage) {
    deleteDialog.value = { open: true, messageId: msg.id }
    closeActionMenu()
  }

  async function confirmDelete() {
    if (!deleteDialog.value.messageId) return
    await opts.deleteMessage(deleteDialog.value.messageId)
    deleteDialog.value = { open: false, messageId: null }
  }

  function onContextMenu(e: MouseEvent, msg: ChatMessage) {
    e.preventDefault()
    actionMenuMsg.value = msg
    // Clamp menu inside viewport. Up to 3 items now (reply + edit + delete).
    const menuWidth = 180
    const menuHeight = 130
    actionMenuPos.value = {
      x: Math.min(e.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(e.clientY, window.innerHeight - menuHeight - 8),
    }
  }

  function closeActionMenu() {
    actionMenuPos.value = null
    actionMenuMsg.value = null
  }

  function closeOnOutsideClick(e: MouseEvent) {
    if (!actionMenuMsg.value) return
    const target = e.target as HTMLElement
    if (target.closest('.msg-context-menu')) return
    closeActionMenu()
  }

  onMounted(() => document.addEventListener('click', closeOnOutsideClick))
  onUnmounted(() => document.removeEventListener('click', closeOnOutsideClick))

  return {
    editingMessageId,
    editingMessage,
    editText,
    replyingTo,
    deleteDialog,
    actionMenuPos,
    actionMenuMsg,
    canEdit,
    canDelete,
    canReply,
    startEditing,
    cancelEditing,
    submitEdit,
    startReplying,
    cancelReplying,
    askDelete,
    confirmDelete,
    onContextMenu,
    closeActionMenu,
  }
}
