import type { TgMessageContent, TgIncomingEvent } from '@telecrm/shared'
import { REDIS_CHANNELS } from '@telecrm/shared'
import { redis } from './redis.js'

const botCache = new Map<number, boolean>()

async function isBotUser(client: any, userId: number): Promise<boolean> {
  if (botCache.has(userId)) return botCache.get(userId)!
  try {
    const user = await client.invoke({ _: 'getUser', user_id: userId })
    const result = user.type._ === 'userTypeBot'
    botCache.set(userId, result)
    return result
  } catch {
    return false
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

    // skip bots
    if (await isBotUser(client, senderId)) return

    const event: TgIncomingEvent = {
      chatId: msg.chat_id,
      messageId: msg.id,
      senderId,
      content: parseContent(msg.content),
      date: msg.date,
    }

    await redis.publish(REDIS_CHANNELS.tgIncoming, JSON.stringify(event))

    const preview = event.content.type === 'text'
      ? event.content.text.slice(0, 60)
      : `[${event.content.type}]`
    console.log(`[tg-worker] → chat ${event.chatId}: ${preview}`)
  })
}
