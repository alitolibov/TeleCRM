import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { TgMessageContent } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'
import { parseContent } from './messages.js'

export interface TgRefreshMessageRequest {
  chatId: number
  messageId: number
}

export interface TgRefreshMessageResponse {
  content?: TgMessageContent
}

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

/**
 * Re-fetches a message from TDLib and returns its current content. Used to
 * heal messages whose `remoteFileId` was never captured at insert time —
 * typically photos/documents pulled in via the history-sync script, where
 * TDLib hadn't filled in `photo.remote.id` yet. After a re-auth those
 * messages can't be re-downloaded by the stale local id, so we ask TDLib
 * for the latest representation and rewrite the content jsonb.
 */
export function setupRefreshMessageWorker(client: any) {
  const worker = new Worker<TgRefreshMessageRequest, TgRefreshMessageResponse>(
    REDIS_QUEUES.tgRefreshMessage,
    async (job: Job<TgRefreshMessageRequest, TgRefreshMessageResponse>) => {
      const { chatId, messageId } = job.data
      try {
        const tdMessage = await client.invoke({
          _: 'getMessage',
          chat_id: chatId,
          message_id: messageId,
        })
        if (!tdMessage?.content) return {}
        const content = parseContent(tdMessage.content)
        return { content }
      } catch (e) {
        console.error(`[tg-worker] refresh-message ${chatId}/${messageId} failed:`, (e as Error).message)
        return {}
      }
    },
    { connection: buildRedisConnection(), concurrency: 4 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[tg-worker] refresh-message job ${job?.id} failed:`, err.message)
  })

  return worker
}
