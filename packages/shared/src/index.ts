export const APP_NAME = 'TeleCRM'

export const REDIS_CHANNELS = {
  tgIncoming: 'tg:incoming',
  tgConnection: 'tg:connection',
} as const

export const REDIS_QUEUES = {
  tgOutgoing: 'tg-outgoing',
  tgIncoming: 'tg-incoming',
  tgHistoryRequest: 'tg-history-request',
} as const

export type { TgMessageEvent, TgIncomingEvent, TgMessageContent, TgConnectionEvent } from './events.js'
export type {
  TgOutgoingJob,
  TgOutgoingContent,
  TgHistoryRequestJob,
  TgHistoryResponse,
} from './jobs.js'
