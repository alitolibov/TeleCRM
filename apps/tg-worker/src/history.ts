import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { TgHistoryRequestJob, TgHistoryResponse, TgMessageEvent } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'
import { getTgUser, parseContent, toClientSnapshot } from './messages.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

export function setupHistoryWorker(client: any) {
  const worker = new Worker<TgHistoryRequestJob, TgHistoryResponse>(
    REDIS_QUEUES.tgHistoryRequest,
    async (job: Job<TgHistoryRequestJob, TgHistoryResponse>) => {
      const { chatId, fromMessageId, limit } = job.data

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const user = await getTgUser(client, chatId)
      if (!user || user.type._ === 'userTypeBot') return { messages: [] }

      // Prime TDLib: load the chat + keep it open so getChatHistory fetches from the
      // server (a freshly logged-in account downloads message history lazily).
      await client.invoke({ _: 'getChat', chat_id: chatId }).catch(() => {})
      await client.invoke({ _: 'openChat', chat_id: chatId }).catch(() => {})

      // getChatHistory returns messages going backwards from `from_message_id` (0 =
      // latest) and only what's cached locally; the rest downloads in the background.
      // So we page backwards, accumulating up to `limit`, retrying on empty batches
      // to give the server fetch time to land. This reliably pulls the full history.
      const want = Math.min(limit, 100)
      const seen = new Set<number>()
      if (fromMessageId) seen.add(fromMessageId)   // never re-include the scroll anchor
      const collected: any[] = []
      let from = fromMessageId || 0
      let emptyRetries = 0

      for (let i = 0; i < 15 && collected.length < want; i++) {
        const res: any = await client.invoke({
          _: 'getChatHistory',
          chat_id: chatId,
          from_message_id: from,
          offset: 0,
          limit: 100,
          only_local: false,
        })
        const batch: any[] = res.messages ?? []
        if (batch.length === 0) {
          if (emptyRetries++ >= 3) break       // server has nothing more / not ready
          await sleep(700)
          continue
        }
        emptyRetries = 0
        for (const m of batch) {
          if (!seen.has(m.id)) { seen.add(m.id); collected.push(m) }
        }
        from = batch[batch.length - 1].id        // oldest in batch → next page anchor
      }

      const messages: TgMessageEvent[] = []
      let skippedSender = 0
      for (const msg of collected) {
        if (msg.sender_id?._ === 'messageSenderChat') { skippedSender++; continue }
        messages.push({
          chatId: msg.chat_id,
          messageId: msg.id,
          isOutgoing: !!msg.is_outgoing,
          client: toClientSnapshot(user, chatId),
          content: parseContent(msg.content),
          date: msg.date,
        })
      }

      console.log(
        `[tg-worker] history chat=${chatId} from=${fromMessageId} ` +
        `→ ${messages.length} msgs (raw=${collected.length}, skipped=${skippedSender})`
      )
      return { messages }
    },
    { connection: buildRedisConnection() },
  )

  worker.on('failed', (job, err) => {
    console.error(`[tg-worker] history job ${job?.id} failed:`, err.message)
  })

  return worker
}
