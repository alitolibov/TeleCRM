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
  tgEdit: 'tg-edit',
  tgDelete: 'tg-delete',
  tgIncomingEdited: 'tg-incoming-edited',
  tgIncomingDeleted: 'tg-incoming-deleted',
  tgIdRemap: 'tg-id-remap',
} as const

export type {
  TgMessageEvent,
  TgIncomingEvent,
  TgMessageContent,
  TgConnectionEvent,
  TgReadSyncEvent,
  TgMessageEditedEvent,
  TgMessageDeletedEvent,
  TgMessageIdRemapEvent,
} from './events.js'
export type {
  TgOutgoingJob,
  TgOutgoingContent,
  TgHistoryRequestJob,
  TgHistoryResponse,
  TgFileRequestJob,
  TgFileResponse,
  TgEditJob,
  TgDeleteJob,
} from './jobs.js'
