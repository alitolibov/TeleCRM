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
      const { chatId, content } = job.data

      if (content.type === 'text') {
        await client.invoke({
          _: 'sendMessage',
          chat_id: chatId,
          input_message_content: {
            _: 'inputMessageText',
            text: { _: 'formattedText', text: content.text, entities: [] },
          },
        })
        return
      }

      if (content.type === 'photo') {
        await client.invoke({
          _: 'sendMessage',
          chat_id: chatId,
          input_message_content: {
            _: 'inputMessagePhoto',
            photo: { _: 'inputFileLocal', path: content.filePath },
            caption: content.caption
              ? { _: 'formattedText', text: content.caption, entities: [] }
              : undefined,
          },
        })
        return
      }

      if (content.type === 'document') {
        await client.invoke({
          _: 'sendMessage',
          chat_id: chatId,
          input_message_content: {
            _: 'inputMessageDocument',
            document: { _: 'inputFileLocal', path: content.filePath },
            caption: content.caption
              ? { _: 'formattedText', text: content.caption, entities: [] }
              : undefined,
          },
        })
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
