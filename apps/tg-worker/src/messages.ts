import { Queue } from 'bullmq'
import type { TgMessageContent, TgIncomingEvent } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

const incomingQueue = new Queue<TgIncomingEvent>(REDIS_QUEUES.tgIncoming, {
  connection: buildRedisConnection(),
  defaultJobOptions: { removeOnComplete: 500, removeOnFail: 100 },
})

const userCache = new Map<number, any>()

async function getTgUser(client: any, userId: number): Promise<any | null> {
  if (userCache.has(userId)) return userCache.get(userId)
  try {
    const user = await client.invoke({ _: 'getUser', user_id: userId })
    userCache.set(userId, user)
    return user
  } catch {
    return null
  }
}

function parseContent(tdContent: any): TgMessageContent {
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
        width: largest.width,
        height: largest.height,
      }
    }

    case 'messageVideo':
      return {
        type: 'video',
        caption: tdContent.caption?.text || undefined,
        fileId: tdContent.video.video.id,
        duration: tdContent.video.duration,
      }

    case 'messageVoiceNote':
      return {
        type: 'voice',
        fileId: tdContent.voice_note.voice.id,
        duration: tdContent.voice_note.duration,
      }

    case 'messageDocument':
      return {
        type: 'document',
        caption: tdContent.caption?.text || undefined,
        fileId: tdContent.document.document.id,
        fileName: tdContent.document.file_name,
        mimeType: tdContent.document.mime_type,
        size: tdContent.document.document.size,
      }

    case 'messageSticker':
      return {
        type: 'sticker',
        fileId: tdContent.sticker.sticker.id,
        emoji: tdContent.sticker.emoji,
      }

    default:
      return { type: 'unsupported' }
  }
}

export function setupMessageHandler(client: any) {
  client.on('update', async (update: any) => {
    if (update._ !== 'updateNewMessage') return

    const msg = (update as any).message

    // private chats only — group/channel IDs are negative
    if (msg.chat_id <= 0) return

    // skip our own outgoing messages
    if (msg.is_outgoing) return

    // only user senders (not anonymous/channel)
    if (msg.sender_id._ !== 'messageSenderUser') return

    const senderId: number = msg.sender_id.user_id

    const tgUser = await getTgUser(client, senderId)
    if (!tgUser || tgUser.type._ === 'userTypeBot') return

    const event: TgIncomingEvent = {
      chatId: msg.chat_id,
      messageId: msg.id,
      senderId,
      senderFirstName: tgUser.first_name || 'Unknown',
      senderLastName: tgUser.last_name || undefined,
      senderUsername: tgUser.usernames?.active_usernames?.[0] ?? tgUser.username ?? undefined,
      content: parseContent(msg.content),
      date: msg.date,
    }

    // jobId = chatId-messageId ensures deduplication if TDLib replays backlog
    await incomingQueue.add('incoming', event, {
      jobId: `${event.chatId}-${event.messageId}`,
    })

    const preview = event.content.type === 'text'
      ? event.content.text.slice(0, 60)
      : `[${event.content.type}]`
    console.log(`[tg-worker] → chat ${event.chatId}: ${preview}`)
  })
}
