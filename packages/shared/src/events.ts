export interface TgMessageEvent {
  chatId: number
  messageId: number
  isOutgoing: boolean
  client: {
    telegramId: number
    firstName: string
    lastName?: string
    username?: string
    /** E.164 phone if TDLib has it; missing when the client hid their number. */
    phone?: string
    /** Whether the CRM-account's Telegram has this user in its address book. */
    isContact?: boolean
  }
  content: TgMessageContent
  date: number
  /** TDLib's authoritative unread count at time of capture (incoming only). */
  unreadCount?: number
  /** TG message id of the message this one replies to, if any. */
  replyToMessageId?: number
  /** Present when the message arrived via TG forward — drives the
   *  "Переслано от …" banner in the receiving chat's bubble. `name` is the
   *  original sender's display name (already resolved by the worker). */
  forwardedFrom?: {
    name: string
    date: number       // unix seconds
  }
}

/** @deprecated use TgMessageEvent */
export type TgIncomingEvent = TgMessageEvent

export type TgMessageContent =
  | { type: 'text'; text: string }
  | { type: 'photo'; caption?: string; fileId: number; remoteFileId?: string; width: number; height: number }
  | { type: 'video'; caption?: string; fileId: number; remoteFileId?: string; duration: number }
  | { type: 'videoNote'; fileId: number; remoteFileId?: string; duration: number; length: number }
  | { type: 'voice'; fileId: number; remoteFileId?: string; duration: number }
  | { type: 'document'; caption?: string; fileId: number; remoteFileId?: string; fileName: string; mimeType: string; size: number }
  | { type: 'sticker'; fileId: number; remoteFileId?: string; emoji: string }
  | { type: 'unsupported' }

export interface TgConnectionEvent {
  state: 'connecting' | 'connected' | 'disconnected'
  timestamp: number
}

/**
 * Fired by TDLib when the user reads messages on any of their devices.
 * Lets the CRM sync its unread badge to whatever Telegram thinks is true.
 */
export interface TgReadSyncEvent {
  chatId: number              // telegram chat id (= client's user_id for private chats)
  lastReadMessageId: number   // newest message ID that has been read
  unreadCount: number         // remaining unread messages
}

/** Fired by TDLib when a message (own or client's) was edited. */
export interface TgMessageEditedEvent {
  chatId: number
  messageId: number
  content: TgMessageContent
  editDate: number            // unix seconds
}

/** Fired by TDLib when messages were deleted in a chat. */
export interface TgMessageDeletedEvent {
  chatId: number
  messageIds: number[]
}

/** Fired by TDLib when a message's pinned state changes — covers both pins
 *  from our own CRM (echo) and pins done in the user's Telegram client. */
export interface TgMessagePinnedEvent {
  chatId: number              // telegram chat id
  messageId: number           // telegram message id
  isPinned: boolean
}

/** TDLib UserStatus bucket — what we surface in the chat header subline.
 *   · 'online'      → currently online (TDLib emits an `expires` we don't
 *                     bother tracking; the next status update flips it).
 *   · 'offline'     → precise last-seen time available (was_online unix).
 *   · 'recently'    → "был(а) недавно" — privacy bucket, no timestamp.
 *   · 'last_week'   → within the last week, bucket.
 *   · 'last_month'  → within the last month, bucket.
 *   · 'long_ago'    → "был(а) давно".
 *   · 'empty'       → status hidden entirely. */
export type TgUserOnlineStatus =
  | 'online' | 'offline' | 'recently'
  | 'last_week' | 'last_month' | 'long_ago' | 'empty'

export interface TgUserStatusEvent {
  userId: number              // telegram user id
  status: TgUserOnlineStatus
  /** Unix seconds of last-seen — only set when `status === 'offline'`. */
  lastSeenAt?: number
}

/** TDLib's updateChatReadOutbox — the OTHER side read our outgoing messages
 *  up to `lastReadMessageId`. Drives the ✓ → ✓✓ flip in MessageBubble. */
export interface TgOutboxReadEvent {
  chatId: number              // telegram chat id
  lastReadMessageId: number   // every outgoing message with id ≤ this is read
}

/** TDLib's chat-action / user-chat-action — typing & related indicators. */
export type TgChatAction =
  | 'typing' | 'photo' | 'video' | 'voice' | 'video_note'
  | 'document' | 'sticker' | 'location' | 'contact' | 'game'

export interface TgChatActionEvent {
  chatId: number
  /** 'cancel' means the user stopped — frontend should clear the indicator. */
  action: TgChatAction | 'cancel'
}

/**
 * Fired by TDLib after our outgoing message has been successfully delivered —
 * at this point its message id changes from a temporary one (seen earlier via
 * updateNewMessage) to a permanent one. CRM must remap the row to the new id
 * so subsequent edit/delete calls work.
 */
export interface TgMessageIdRemapEvent {
  chatId: number
  oldMessageId: number
  newMessageId: number
}
