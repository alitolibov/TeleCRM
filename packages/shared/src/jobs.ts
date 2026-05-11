export interface TgOutgoingJob {
  chatId: number
  content: TgOutgoingContent
}

export type TgOutgoingContent =
  | { type: 'text'; text: string }
  | { type: 'photo'; filePath: string; caption?: string }
  | { type: 'document'; filePath: string; fileName: string; caption?: string }
