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
  tgAddContact: 'tg-add-contact',
  tgClientRefresh: 'tg-client-refresh',
  tgPin: 'tg-pin',
  tgForward: 'tg-forward',
  tgChatSearch: 'tg-chat-search',
  tgIncomingPinned: 'tg-incoming-pinned',
  tgUserStatus: 'tg-user-status',
  tgOutboxRead: 'tg-outbox-read',
  tgChatAction: 'tg-chat-action',
  tgRefreshMessage: 'tg-refresh-message',
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
  TgMessagePinnedEvent,
  TgUserOnlineStatus,
  TgUserStatusEvent,
  TgOutboxReadEvent,
  TgChatAction,
  TgChatActionEvent,
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
  TgAddContactJob,
  TgClientRefreshRequest,
  TgClientRefreshResponse,
  TgPinJob,
  TgForwardJob,
  TgChatSearchRequest,
  TgChatSearchResponse,
  TgChatSearchResult,
} from './jobs.js'
