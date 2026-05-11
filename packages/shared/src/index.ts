export const APP_NAME = 'TeleCRM'

export const REDIS_CHANNELS = {
  tgIncoming: 'tg:incoming',
  tgConnection: 'tg:connection',
} as const

export const REDIS_QUEUES = {
  tgOutgoing: 'tg-outgoing',
} as const

export type { TgIncomingEvent, TgMessageContent, TgConnectionEvent } from './events.js'
export type { TgOutgoingJob, TgOutgoingContent } from './jobs.js'
