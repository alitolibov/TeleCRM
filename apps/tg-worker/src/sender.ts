import { Worker } from 'bullmq'
import type { TgOutgoingJob } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
  }
}

export function setupSender(client: any) {
  const worker = new Worker<TgOutgoingJob>(
    REDIS_QUEUES.tgOutgoing,
    async (job) => {
      const { chatId, content, replyToMessageId } = job.data

      /** Build sendMessage payload and add reply_to only when present —
       *  TDLib rejects an explicit `null`/`undefined` reply_to in some builds. */
      function buildPayload(input: any) {
        const payload: any = {
          _: 'sendMessage',
          chat_id: chatId,
          input_message_content: input,
        }
        if (replyToMessageId) {
          payload.reply_to = {
            _: 'inputMessageReplyToMessage',
            chat_id: chatId,                  // same-chat reply (kept for older builds)
            message_id: replyToMessageId,
          }
        }
        return payload
      }

      if (content.type === 'text') {
        await client.invoke(buildPayload({
          _: 'inputMessageText',
          text: { _: 'formattedText', text: content.text, entities: [] },
        }))
        return
      }

      if (content.type === 'photo') {
        await client.invoke(buildPayload({
          _: 'inputMessagePhoto',
          photo: { _: 'inputFileLocal', path: content.filePath },
          caption: content.caption
            ? { _: 'formattedText', text: content.caption, entities: [] }
            : undefined,
        }))
        return
      }

      if (content.type === 'document') {
        await client.invoke(buildPayload({
          _: 'inputMessageDocument',
          document: { _: 'inputFileLocal', path: content.filePath },
          caption: content.caption
            ? { _: 'formattedText', text: content.caption, entities: [] }
            : undefined,
        }))
        return
      }

      if (content.type === 'viewMessages') {
        // TDLib only acts on viewMessages for "open" chats — make sure it's open
        // before sending the read receipt so the client sees double-check.
        await client.invoke({ _: 'openChat', chat_id: chatId }).catch(() => {})
        await client.invoke({
          _: 'viewMessages',
          chat_id: chatId,
          message_ids: content.messageIds,
          source: { _: 'messageSourceChatHistory' },
          force_read: true,
        }).catch((e: Error) => console.error('[tg-worker] viewMessages failed:', e.message))
        return
      }
    },
    {
      connection: buildRedisConnection(),
      concurrency: 1,
    },
  )

  worker.on('completed', (job) => {
    console.log(`[tg-worker] ← sent ${job.data.content.type} to chat ${job.data.chatId}`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[tg-worker] send failed (chat ${job?.data.chatId}):`, err.message)
  })

  return worker
}
