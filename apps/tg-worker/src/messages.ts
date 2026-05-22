import { Queue } from 'bullmq'
import type {
  TgMessageContent,
  TgMessageEvent,
  TgReadSyncEvent,
  TgMessageEditedEvent,
  TgMessageDeletedEvent,
  TgMessageIdRemapEvent,
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

const userCache = new Map<number, any>()

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
          client: {
            telegramId: chatId,
            firstName: user.first_name || 'Unknown',
            lastName: user.last_name || undefined,
            username: user.usernames?.active_usernames?.[0] ?? user.username ?? undefined,
          },
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

    const event: TgMessageEvent = {
      chatId: msg.chat_id,
      messageId: msg.id,
      isOutgoing,
      client: {
        telegramId: msg.chat_id,
        firstName: clientUser.first_name || 'Unknown',
        lastName: clientUser.last_name || undefined,
        username: clientUser.usernames?.active_usernames?.[0] ?? clientUser.username ?? undefined,
      },
      content: parseContent(msg.content),
      date: msg.date,
      unreadCount,
      replyToMessageId: msg.reply_to?.message_id || undefined,
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

    // edit_date is on the message itself, not on this update — fetch it
    let editDate = Math.floor(Date.now() / 1000)
    try {
      const msg = await client.invoke({
        _: 'getMessage',
        chat_id: update.chat_id,
        message_id: update.message_id,
      })
      if (msg?.edit_date) editDate = msg.edit_date
    } catch {}

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
}
