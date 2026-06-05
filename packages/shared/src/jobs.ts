import type { TgMessageEvent } from './events.js'

export interface TgOutgoingJob {
  chatId: number
  content: TgOutgoingContent
  /** If set, send as a reply to this Telegram message id (within same chat). */
  replyToMessageId?: number
}

export type TgOutgoingContent =
  | { type: 'text'; text: string }
  | { type: 'photo'; filePath: string; caption?: string }
  | { type: 'video'; filePath: string; caption?: string }
  | { type: 'document'; filePath: string; fileName: string; caption?: string }
  /** 2-10 photos/videos sent grouped as a Telegram album (media group). */
  | { type: 'album'; items: Array<{ kind: 'photo' | 'video'; filePath: string }>; caption?: string }
  | { type: 'viewMessages'; messageIds: number[] }

export interface TgHistoryRequestJob {
  chatId: number          // Telegram chat ID
  fromMessageId: number   // 0 = latest; otherwise return messages older than this
  limit: number
}

export interface TgHistoryResponse {
  messages: TgMessageEvent[]
}

export interface TgFileRequestJob {
  fileId: number
  remoteFileId?: string
  /** Content type from the message — lets the worker pass a proper FileType
   *  to TDLib's getRemoteFile (passing fileTypeNone aborts TDLib for some files). */
  contentType?: 'photo' | 'video' | 'voice' | 'videoNote' | 'document' | 'sticker'
}

export interface TgFileResponse {
  path: string | null
  mime?: string
}

export interface TgEditJob {
  chatId: number
  messageId: number          // Telegram message id
  /** New text (for text messages) or new caption (for media). Empty string clears caption. */
  text: string
  /** If true, this is editing a media caption; if false, replacing message text. */
  isCaption: boolean
}

export interface TgDeleteJob {
  chatId: number
  messageIds: number[]       // Telegram message ids
  /** revoke=true → delete for everyone; false → only on our side (rarely useful). */
  revoke: boolean
}

export interface TgAddContactJob {
  /** Telegram user id of the contact — required so TDLib can target the right account. */
  userId: number
  /** Phone in E.164 (e.g. "+998901234567"). Empty when we only know the user id; TDLib
   *  needs a phone to actually create the contact, so an empty value is best-effort only. */
  phoneNumber: string
  firstName: string
  lastName: string
}

/**
 * Ask the worker for a fresh profile snapshot — used by the API when it has
 * to render a client whose `phone` is null but who may have un-hidden their
 * number since the last incoming message.
 */
export interface TgClientRefreshRequest {
  telegramId: number
  /** If known, used to force a server-side refresh via searchPublicChat —
   *  without that, TDLib happily returns its stale local snapshot, even
   *  after the client changed their phone-visibility setting. */
  username?: string
}

export interface TgClientRefreshResponse {
  firstName?: string
  lastName?: string
  username?: string
  phone?: string
  isContact?: boolean
}

/** Pin or unpin a message in a private TG chat (shown to the client too). */
export interface TgPinJob {
  chatId: number          // TG chat id (== client's user id for private chats)
  messageId: number       // TG message id
  pin: boolean            // true = pin, false = unpin
}

/** Forward existing TG messages from one chat to another via TDLib
 *  `forwardMessages`. Destination is a TG chat id, not a CRM uuid. */
export interface TgForwardJob {
  fromChatId: number
  messageIds: number[]
  toChatId: number
}

/** Look up TG chats the CRM-account has access to — drives the forward
 *  picker. `q` is matched against TDLib's `searchChats` (local) and
 *  `searchChatsOnServer` (global) results. */
export interface TgChatSearchRequest {
  q: string
  limit?: number
}

export interface TgChatSearchResult {
  /** TG chat id — positive for users, negative for groups/channels. */
  id: number
  title: string
  /** Type hint so the UI can show different icons. */
  type: 'user' | 'group' | 'channel' | 'other'
  username?: string
}

export interface TgChatSearchResponse {
  items: TgChatSearchResult[]
}
