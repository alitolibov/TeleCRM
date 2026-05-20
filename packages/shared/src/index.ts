export const APP_NAME = 'TeleCRM'

export const REDIS_CHANNELS = {
  tgIncoming: 'tg:incoming',
  tgConnection: 'tg:connection',
} as const

export const REDIS_QUEUES = {
  tgOutgoing: 'tg-outgoing',
  tgIncoming: 'tg-incoming',
  tgHistoryRequest: 'tg-history-request',
  tgFileRequest: 'tg-file-request',
  tgReadSync: 'tg-read-sync',
} as const

export type {
  TgMessageEvent,
  TgIncomingEvent,
  TgMessageContent,
  TgConnectionEvent,
  TgReadSyncEvent,
} from './events.js'
export type {
  TgOutgoingJob,
  TgOutgoingContent,
  TgHistoryRequestJob,
  TgHistoryResponse,
  TgFileRequestJob,
  TgFileResponse,
} from './jobs.js'
