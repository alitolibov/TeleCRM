import type { TgMessageEvent } from './events.js'

export interface TgOutgoingJob {
  chatId: number
  content: TgOutgoingContent
}

export type TgOutgoingContent =
  | { type: 'text'; text: string }
  | { type: 'photo'; filePath: string; caption?: string }
  | { type: 'document'; filePath: string; fileName: string; caption?: string }

export interface TgHistoryRequestJob {
  chatId: number          // Telegram chat ID
  fromMessageId: number   // 0 = latest; otherwise return messages older than this
  limit: number
}

export interface TgHistoryResponse {
  messages: TgMessageEvent[]
}
