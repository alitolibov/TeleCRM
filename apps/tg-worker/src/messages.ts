import { Queue } from 'bullmq'
import type {
  TgMessageContent,
  TgMessageEvent,
  TgReadSyncEvent,
  TgMessageEditedEvent,
  TgMessageDeletedEvent,
  TgMessageIdRemapEvent,
  TgMessagePinnedEvent,
  TgUserStatusEvent,
  TgUserOnlineStatus,
  TgOutboxReadEvent,
  TgChatActionEvent,
  TgChatAction,
} from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

const messageQueue = new Queue<TgMessageEvent>(REDIS_QUEUES.tgIncoming, {
  connection: buildRedisConnection(),
  defaultJobOptions: { removeOnComplete: 500, removeOnFail: 100 },
})

const readSyncQueue = new Queue<TgReadSyncEvent>(REDIS_QUEUES.tgReadSync, {
  connection: buildRedisConnection(),
  defaultJobOptions: { removeOnComplete: 200, removeOnFail: 50 },
})

const editedQueue = new Queue<TgMessageEditedEvent>(REDIS_QUEUES.tgIncomingEdited, {
  connection: buildRedisConnection(),
  defaultJobOptions: { removeOnComplete: 200, removeOnFail: 50 },
})

const deletedQueue = new Queue<TgMessageDeletedEvent>(REDIS_QUEUES.tgIncomingDeleted, {
  connection: buildRedisConnection(),
  defaultJobOptions: { removeOnComplete: 200, removeOnFail: 50 },
})

const idRemapQueue = new Queue<TgMessageIdRemapEvent>(REDIS_QUEUES.tgIdRemap, {
  connection: buildRedisConnection(),
  defaultJobOptions: { removeOnComplete: 500, removeOnFail: 100 },
})

const pinnedQueue = new Queue<TgMessagePinnedEvent>(REDIS_QUEUES.tgIncomingPinned, {
  connection: buildRedisConnection(),
  defaultJobOptions: { removeOnComplete: 200, removeOnFail: 50 },
})

const userStatusQueue = new Queue<TgUserStatusEvent>(REDIS_QUEUES.tgUserStatus, {
  connection: buildRedisConnection(),
  // High churn (TDLib fires this every few seconds per active user) — keep
  // the visible job set tight so the queue doesn't bloat Redis.
  defaultJobOptions: { removeOnComplete: 50, removeOnFail: 20 },
})

const outboxReadQueue = new Queue<TgOutboxReadEvent>(REDIS_QUEUES.tgOutboxRead, {
  connection: buildRedisConnection(),
  defaultJobOptions: { removeOnComplete: 200, removeOnFail: 50 },
})

const chatActionQueue = new Queue<TgChatActionEvent>(REDIS_QUEUES.tgChatAction, {
  connection: buildRedisConnection(),
  // Even higher churn than status — keystroke-rate events. Drop completed
  // jobs aggressively; nothing depends on history.
  defaultJobOptions: { removeOnComplete: 20, removeOnFail: 10 },
})

const userCache = new Map<number, any>()

/** Snapshot a TDLib user into the wire-format we send to the API. Centralised so
 *  every event source (new message, history, sync) emits the same shape, and so
 *  the phone field gets picked up wherever it appears. */
export function toClientSnapshot(user: any, telegramId: number) {
  return {
    telegramId,
    firstName: user.first_name || 'Unknown',
    lastName: user.last_name || undefined,
    username: user.usernames?.active_usernames?.[0] ?? user.username ?? undefined,
    // TDLib returns '' when the phone isn't shared with us — collapse to undefined.
    phone: user.phone_number ? `+${String(user.phone_number).replace(/^\+/, '')}` : undefined,
    // TDLib's truth on whether the CRM-account knows them as a contact.
    isContact: !!user.is_contact,
  }
}

export async function getTgUser(client: any, userId: number): Promise<any | null> {
  if (userCache.has(userId)) return userCache.get(userId)
  try {
    const user = await client.invoke({ _: 'getUser', user_id: userId })
    userCache.set(userId, user)
    return user
  } catch {
    // User not in TDLib's cache — fetching the chat populates it
    try {
      await client.invoke({ _: 'getChat', chat_id: userId })
      const user = await client.invoke({ _: 'getUser', user_id: userId })
      userCache.set(userId, user)
      return user
    } catch (e) {
      console.warn(`[tg-worker] cannot resolve user ${userId}:`, (e as Error).message)
      return null
    }
  }
}

/**
 * Resolve TDLib's messageForwardInfo into the small { name, date } shape the
 * API/UI uses. Three origin types in practice:
 *   · messageOriginUser — sender_user_id → getUser → "First Last";
 *   · messageOriginHiddenUser — sender_name is the only thing we get (privacy);
 *   · messageOriginChannel / messageOriginChat — chat_id → getChat → title.
 */
export async function parseForwardInfo(
  client: any,
  forwardInfo: any,
): Promise<{ name: string; date: number } | undefined> {
  if (!forwardInfo) return undefined
  const origin = forwardInfo.origin
  if (!origin) return undefined
  let name = ''
  switch (origin._) {
    case 'messageOriginUser': {
      const user = await getTgUser(client, origin.sender_user_id).catch(() => null)
      name = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim()
        || `id ${origin.sender_user_id}`
      break
    }
    case 'messageOriginHiddenUser':
      name = origin.sender_name || 'Скрытый пользователь'
      break
    case 'messageOriginChannel':
    case 'messageOriginChat': {
      const chat = await client.invoke({ _: 'getChat', chat_id: origin.chat_id }).catch(() => null)
      name = chat?.title || `chat ${origin.chat_id}`
      break
    }
    default:
      return undefined
  }
  return { name, date: forwardInfo.date }
}

export function parseContent(tdContent: any): TgMessageContent {
  switch (tdContent._) {
    case 'messageText':
      return { type: 'text', text: tdContent.text.text }

    case 'messagePhoto': {
      const sizes = tdContent.photo.sizes as any[]
      const largest = sizes[sizes.length - 1]
      return {
        type: 'photo',
        caption: tdContent.caption?.text || undefined,
        fileId: largest.photo.id,
        remoteFileId: largest.photo.remote?.id || undefined,
        width: largest.width,
        height: largest.height,
      }
    }

    case 'messageVideo':
      return {
        type: 'video',
        caption: tdContent.caption?.text || undefined,
        fileId: tdContent.video.video.id,
        remoteFileId: tdContent.video.video.remote?.id || undefined,
        duration: tdContent.video.duration,
      }

    case 'messageVoiceNote':
      return {
        type: 'voice',
        fileId: tdContent.voice_note.voice.id,
        remoteFileId: tdContent.voice_note.voice.remote?.id || undefined,
        duration: tdContent.voice_note.duration,
      }

    case 'messageVideoNote':
      return {
        type: 'videoNote',
        fileId: tdContent.video_note.video.id,
        remoteFileId: tdContent.video_note.video.remote?.id || undefined,
        duration: tdContent.video_note.duration,
        length: tdContent.video_note.length,
      }

    case 'messageDocument':
      return {
        type: 'document',
        caption: tdContent.caption?.text || undefined,
        fileId: tdContent.document.document.id,
        remoteFileId: tdContent.document.document.remote?.id || undefined,
        fileName: tdContent.document.file_name,
        mimeType: tdContent.document.mime_type,
        size: tdContent.document.document.size,
      }

    case 'messageSticker':
      return {
        type: 'sticker',
        fileId: tdContent.sticker.sticker.id,
        remoteFileId: tdContent.sticker.sticker.remote?.id || undefined,
        emoji: tdContent.sticker.emoji,
      }

    default:
      return { type: 'unsupported' }
  }
}

/**
 * Pulls the user's recent private chats from TDLib and seeds them as the
 * chat's last message in our queue. Without this, the CRM only sees chats
 * that received messages while the worker was running.
 */
export async function syncChats(client: any, limit: number = 100): Promise<void> {
  try {
    // Ensure TDLib has loaded the main chat list
    await client.invoke({ _: 'loadChats', chat_list: { _: 'chatListMain' }, limit }).catch(() => {})

    const result = await client.invoke({
      _: 'getChats',
      chat_list: { _: 'chatListMain' },
      limit,
    })
    const chatIds: number[] = result.chat_ids ?? []

    let synced = 0, skipped = 0
    for (const chatId of chatIds) {
      // private chats only
      if (chatId <= 0) { skipped++; continue }

      try {
        const chatInfo = await client.invoke({ _: 'getChat', chat_id: chatId })
        const lastMsg = chatInfo.last_message
        if (!lastMsg) { skipped++; continue }

        // service messages have non-user senders
        if (lastMsg.sender_id?._ !== 'messageSenderUser') { skipped++; continue }

        const user = await getTgUser(client, chatId)
        if (!user || user.type._ === 'userTypeBot') { skipped++; continue }

        const event: TgMessageEvent = {
          chatId,
          messageId: lastMsg.id,
          isOutgoing: !!lastMsg.is_outgoing,
          client: toClientSnapshot(user, chatId),
          content: parseContent(lastMsg.content),
          date: lastMsg.date,
        }

        await messageQueue.add('sync', event, {
          jobId: `${event.chatId}-${event.messageId}`,
        })
        synced++
      } catch (e) {
        skipped++
      }
    }

    console.log(`[tg-worker] sync: ${synced} chats queued, ${skipped} skipped, ${chatIds.length} total`)
  } catch (err) {
    console.error('[tg-worker] syncChats error:', (err as Error).message)
  }
}

// Telegram service accounts that send notifications (login codes, account
// alerts, etc.) — never relevant to a CRM workflow.
const SERVICE_USER_IDS = new Set<number>([777000])

export function setupMessageHandler(client: any, myUserId: number) {
  console.log(`[tg-worker] message handler ready (skipping self=${myUserId} + service accounts)`)

  // When the user reads messages on another device (phone/desktop), TDLib fires
  // TDLib fires updateUser when a client's profile changes (incl. revealing
  // their phone number). Refresh the cache so the next event we emit carries
  // the fresh data; otherwise getTgUser would keep returning the stale snapshot.
  client.on('update', (update: any) => {
    if (update._ !== 'updateUser') return
    if (update.user?.id) userCache.set(update.user.id, update.user)
  })

  // updateChatReadInbox with the new unread_count. Sync this to CRM so the
  // badge clears without needing to open the chat in CRM.
  client.on('update', async (update: any) => {
    if (update._ !== 'updateChatReadInbox') return
    if (update.chat_id <= 0) return
    if (update.chat_id === myUserId) return
    if (SERVICE_USER_IDS.has(update.chat_id)) return

    await readSyncQueue.add('read', {
      chatId: update.chat_id,
      lastReadMessageId: update.last_read_inbox_message_id,
      unreadCount: update.unread_count,
    }).catch((e) => console.error('[tg-worker] read-sync enqueue failed:', e))
  })
  client.on('update', async (update: any) => {
    if (update._ !== 'updateNewMessage') return

    const msg = update.message

    // private chats only — group/channel IDs are negative
    if (msg.chat_id <= 0) return

    // skip Saved Messages (chat with self) and Telegram service notifications
    if (msg.chat_id === myUserId) return
    if (SERVICE_USER_IDS.has(msg.chat_id)) return

    // skip messages sent on behalf of a channel/chat (extremely rare in 1-on-1)
    if (msg.sender_id?._ === 'messageSenderChat') return

    // TDLib emits a synthetic "pinned" service message when someone pins
    // something in the chat. We don't want it cluttering the timeline as
    // "Сообщение не поддерживается" — the pin is tracked via the chat's
    // pinned_message_id instead. Same for other private-chat service notes
    // we have no UI for (group calls, theme changes, etc.).
    const serviceTypes = new Set([
      'messagePinMessage',
      'messageChatChangePhoto',
      'messageChatChangeTitle',
      'messageChatSetTheme',
      'messageVideoChatStarted',
      'messageVideoChatEnded',
    ])
    if (serviceTypes.has(msg.content?._)) return

    const isOutgoing = !!msg.is_outgoing

    // In private chats, chat_id == other party's user_id (the client)
    const clientUser = await getTgUser(client, msg.chat_id)
    if (!clientUser || clientUser.type._ === 'userTypeBot') return

    // For incoming messages, ask TDLib for its authoritative unread_count.
    // This avoids race conditions where updateChatReadInbox arrives before our
    // own increment, resulting in CRM showing one more than Telegram.
    let unreadCount: number | undefined
    if (!isOutgoing) {
      try {
        const chatInfo = await client.invoke({ _: 'getChat', chat_id: msg.chat_id })
        unreadCount = chatInfo?.unread_count
      } catch {}
    }

    // If TDLib marked the message as a forward, resolve the original sender
    // so the receiving chat can render a "Переслано от …" banner. Hidden
    // origins (sender_name set instead of user_id) we just trust verbatim.
    const forwardedFrom = await parseForwardInfo(client, msg.forward_info).catch(() => undefined)

    const event: TgMessageEvent = {
      chatId: msg.chat_id,
      messageId: msg.id,
      isOutgoing,
      client: toClientSnapshot(clientUser, msg.chat_id),
      content: parseContent(msg.content),
      date: msg.date,
      unreadCount,
      replyToMessageId: msg.reply_to?.message_id || undefined,
      forwardedFrom,
    }

    // jobId = chatId-messageId ensures deduplication if TDLib replays backlog
    await messageQueue.add('message', event, {
      jobId: `${event.chatId}-${event.messageId}`,
    })

    const preview = event.content.type === 'text'
      ? event.content.text.slice(0, 60)
      : `[${event.content.type}]`
    const arrow = isOutgoing ? '←' : '→'
    console.log(`[tg-worker] ${arrow} chat ${event.chatId}: ${preview}`)
  })

  // Edit: TDLib fires updateMessageContent when message body changes (text/caption/media)
  client.on('update', async (update: any) => {
    if (update._ !== 'updateMessageContent') return
    if (update.chat_id <= 0) return
    if (update.chat_id === myUserId) return
    if (SERVICE_USER_IDS.has(update.chat_id)) return

    // updateMessageContent fires for genuine edits AND when an outgoing media
    // upload finalizes (the photo/video/file content resolves after sending).
    // Only a real user edit has a non-zero edit_date — without this guard every
    // freshly-sent photo/file gets falsely flagged as "изменено".
    let editDate = 0
    try {
      const msg = await client.invoke({
        _: 'getMessage',
        chat_id: update.chat_id,
        message_id: update.message_id,
      })
      editDate = msg?.edit_date ?? 0
    } catch {}

    if (!editDate) return  // content finalization after send, not an edit — ignore

    const event: TgMessageEditedEvent = {
      chatId: update.chat_id,
      messageId: update.message_id,
      content: parseContent(update.new_content),
      editDate,
    }
    await editedQueue.add('edited', event).catch((e) =>
      console.error('[tg-worker] edited enqueue failed:', e),
    )
    console.log(`[tg-worker] ✎ msg ${event.messageId} edited in chat ${event.chatId}`)
  })

  // Delete: TDLib fires updateDeleteMessages on actual deletion (when is_permanent=true)
  client.on('update', async (update: any) => {
    if (update._ !== 'updateDeleteMessages') return
    if (update.chat_id <= 0) return
    if (update.chat_id === myUserId) return
    if (SERVICE_USER_IDS.has(update.chat_id)) return
    if (!update.is_permanent) return                       // ignore "from cache" deletions

    const event: TgMessageDeletedEvent = {
      chatId: update.chat_id,
      messageIds: update.message_ids ?? [],
    }
    if (event.messageIds.length === 0) return
    await deletedQueue.add('deleted', event).catch((e) =>
      console.error('[tg-worker] deleted enqueue failed:', e),
    )
    console.log(`[tg-worker] ✕ ${event.messageIds.length} msg(s) deleted in chat ${event.chatId}`)
  })

  // ID remap: TDLib assigns a TEMPORARY message id when sendMessage is invoked.
  // Once the server confirms, it fires updateMessageSendSucceeded with the FINAL id.
  // Without remapping our DB row, subsequent edits/deletes fail with "Message not found".
  client.on('update', async (update: any) => {
    if (update._ !== 'updateMessageSendSucceeded') return
    const msg = update.message
    if (!msg) return
    if (msg.chat_id <= 0 || msg.chat_id === myUserId) return
    if (SERVICE_USER_IDS.has(msg.chat_id)) return

    const event: TgMessageIdRemapEvent = {
      chatId: msg.chat_id,
      oldMessageId: update.old_message_id,
      newMessageId: msg.id,
    }
    await idRemapQueue.add('remap', event).catch((e) =>
      console.error('[tg-worker] id-remap enqueue failed:', e),
    )
    console.log(`[tg-worker] ↻ remap ${event.oldMessageId} → ${event.newMessageId} in chat ${event.chatId}`)
  })

  // Pin/unpin: TDLib fires updateMessageIsPinned both for our own CRM pins
  // (echo) and for pins/unpins the user does directly in the Telegram client.
  // The API processor updates chats.pinned_message_ids and broadcasts.
  client.on('update', async (update: any) => {
    if (update._ !== 'updateMessageIsPinned') return
    if (update.chat_id <= 0 || update.chat_id === myUserId) return
    if (SERVICE_USER_IDS.has(update.chat_id)) return

    const event: TgMessagePinnedEvent = {
      chatId: update.chat_id,
      messageId: update.message_id,
      isPinned: !!update.is_pinned,
    }
    await pinnedQueue.add('pinned', event).catch((e) =>
      console.error('[tg-worker] pinned enqueue failed:', e),
    )
    console.log(`[tg-worker] ${event.isPinned ? '📌' : '↺'} pin event msg ${event.messageId} in chat ${event.chatId}`)
  })

  // Online presence: TDLib fires updateUserStatus for every user it knows
  // about. We forward every positive-user-id update to the API; the API does
  // a no-op `UPDATE … WHERE telegram_id` for users that aren't CRM clients,
  // which is cheap enough not to require worker-side filtering.
  client.on('update', async (update: any) => {
    if (update._ !== 'updateUserStatus') return
    if (typeof update.user_id !== 'number' || update.user_id <= 0) return
    if (update.user_id === myUserId) return
    if (SERVICE_USER_IDS.has(update.user_id)) return

    const event: TgUserStatusEvent = {
      userId: update.user_id,
      status: mapUserStatus(update.status?._),
      lastSeenAt: update.status?._ === 'userStatusOffline'
        ? update.status.was_online
        : undefined,
    }
    // Keep the user cache fresh too — anything that reads `getTgUser` later
    // should know the new status without a refetch round-trip.
    const cached = userCache.get(update.user_id)
    if (cached) userCache.set(update.user_id, { ...cached, status: update.status })

    await userStatusQueue.add('status', event).catch((e) =>
      console.error('[tg-worker] user-status enqueue failed:', e),
    )
  })

  // Outbox-read: the OTHER side opened our message thread and walked their
  // read marker up to `last_read_outbox_message_id`. Drives ✓ → ✓✓ on every
  // outgoing message at or below that id.
  client.on('update', async (update: any) => {
    if (update._ !== 'updateChatReadOutbox') return
    if (update.chat_id <= 0 || update.chat_id === myUserId) return
    if (SERVICE_USER_IDS.has(update.chat_id)) return

    const event: TgOutboxReadEvent = {
      chatId: update.chat_id,
      lastReadMessageId: update.last_read_outbox_message_id,
    }
    await outboxReadQueue.add('outbox-read', event).catch((e) =>
      console.error('[tg-worker] outbox-read enqueue failed:', e),
    )
  })

  // Chat action (typing / recording voice / uploading photo / …). TDLib's
  // own field name changed between API versions — accept both forms. We only
  // forward private-chat actions where the sender is the chat user themselves
  // (the only case meaningful for the header indicator).
  client.on('update', async (update: any) => {
    if (update._ !== 'updateChatAction' && update._ !== 'updateUserChatAction') return
    if (update.chat_id <= 0 || update.chat_id === myUserId) return
    if (SERVICE_USER_IDS.has(update.chat_id)) return
    const senderUserId =
      update.sender_id?._ === 'messageSenderUser'
        ? update.sender_id.user_id
        : update.user_id   // older API shape
    if (typeof senderUserId !== 'number' || senderUserId !== update.chat_id) return

    const event: TgChatActionEvent = {
      chatId: update.chat_id,
      action: mapChatAction(update.action?._),
    }
    await chatActionQueue.add('action', event).catch((e) =>
      console.error('[tg-worker] chat-action enqueue failed:', e),
    )
  })
}

function mapUserStatus(kind: string | undefined): TgUserOnlineStatus {
  switch (kind) {
    case 'userStatusOnline':    return 'online'
    case 'userStatusOffline':   return 'offline'
    case 'userStatusRecently':  return 'recently'
    case 'userStatusLastWeek':  return 'last_week'
    case 'userStatusLastMonth': return 'last_month'
    case 'userStatusEmpty':     return 'empty'
    default:                    return 'long_ago'
  }
}

function mapChatAction(kind: string | undefined): TgChatAction | 'cancel' {
  switch (kind) {
    case 'chatActionTyping':              return 'typing'
    case 'chatActionUploadingPhoto':      return 'photo'
    case 'chatActionUploadingVideo':      return 'video'
    case 'chatActionRecordingVoiceNote':
    case 'chatActionUploadingVoiceNote':  return 'voice'
    case 'chatActionUploadingDocument':   return 'document'
    case 'chatActionChoosingSticker':     return 'sticker'
    case 'chatActionRecordingVideoNote':
    case 'chatActionUploadingVideoNote':  return 'video_note'
    case 'chatActionChoosingLocation':    return 'location'
    case 'chatActionChoosingContact':     return 'contact'
    case 'chatActionStartPlayingGame':    return 'game'
    case 'chatActionCancel':              return 'cancel'
    default:                              return 'cancel'
  }
}
