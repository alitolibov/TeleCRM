export interface TgMessageEvent {
  chatId: number
  messageId: number
  isOutgoing: boolean
  client: {
    telegramId: number
    firstName: string
    lastName?: string
    username?: string
  }
  content: TgMessageContent
  date: number
  /** TDLib's authoritative unread count at time of capture (incoming only). */
  unreadCount?: number
  /** TG message id of the message this one replies to, if any. */
  replyToMessageId?: number
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
