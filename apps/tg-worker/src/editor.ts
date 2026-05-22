import { Worker } from 'bullmq'
import type { TgEditJob, TgDeleteJob } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

export function setupEditor(client: any) {
  const editWorker = new Worker<TgEditJob>(
    REDIS_QUEUES.tgEdit,
    async (job) => {
      const { chatId, messageId, text, isCaption } = job.data
      const formattedText = { _: 'formattedText', text, entities: [] }

      if (isCaption) {
        await client.invoke({
          _: 'editMessageCaption',
          chat_id: chatId,
          message_id: messageId,
          caption: formattedText,
        })
      } else {
        await client.invoke({
          _: 'editMessageText',
          chat_id: chatId,
          message_id: messageId,
          input_message_content: {
            _: 'inputMessageText',
            text: formattedText,
          },
        })
      }
    },
    { connection: buildRedisConnection(), concurrency: 2 },
  )

  editWorker.on('completed', (job) =>
    console.log(`[tg-worker] ✎ edited msg ${job.data.messageId} in chat ${job.data.chatId}`),
  )
  editWorker.on('failed', (job, err) =>
    console.error(`[tg-worker] edit failed (msg ${job?.data.messageId}):`, err.message),
  )

  const deleteWorker = new Worker<TgDeleteJob>(
    REDIS_QUEUES.tgDelete,
    async (job) => {
      const { chatId, messageIds, revoke } = job.data
      await client.invoke({
        _: 'deleteMessages',
        chat_id: chatId,
        message_ids: messageIds,
        revoke,
      })
    },
    { connection: buildRedisConnection(), concurrency: 2 },
  )

  deleteWorker.on('completed', (job) =>
    console.log(`[tg-worker] ✕ deleted ${job.data.messageIds.length} msg(s) in chat ${job.data.chatId}`),
  )
  deleteWorker.on('failed', (job, err) =>
    console.error(`[tg-worker] delete failed (chat ${job?.data.chatId}):`, err.message),
  )

  return { editWorker, deleteWorker }
}
