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
  | { type: 'document'; filePath: string; fileName: string; caption?: string }
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
