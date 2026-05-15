import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { TgHistoryRequestJob, TgHistoryResponse, TgMessageEvent } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'
import { getTgUser, parseContent } from './messages.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

export function setupHistoryWorker(client: any) {
  const worker = new Worker<TgHistoryRequestJob, TgHistoryResponse>(
    REDIS_QUEUES.tgHistoryRequest,
    async (job: Job<TgHistoryRequestJob, TgHistoryResponse>) => {
      const { chatId, fromMessageId, limit } = job.data

      const user = await getTgUser(client, chatId)
      if (!user || user.type._ === 'userTypeBot') return { messages: [] }

      // Ensure TDLib is actively maintaining this chat — required for getChatHistory
      // to pull older messages from the Telegram server (not just local cache).
      await client.invoke({ _: 'openChat', chat_id: chatId }).catch(() => {})

      // First call may return only locally cached messages; retry once with only_local: false
      // so TDLib will fetch from the server if the local store is empty.
      let result = await client.invoke({
        _: 'getChatHistory',
        chat_id: chatId,
        from_message_id: fromMessageId || 0,
        offset: 0,
        limit: Math.min(limit, 100),
        only_local: false,
      })

      // TDLib often returns 0 on the first cold call — give it another shot after a brief sync window
      if ((result.messages ?? []).length === 0 && fromMessageId === 0) {
        await new Promise((r) => setTimeout(r, 500))
        result = await client.invoke({
          _: 'getChatHistory',
          chat_id: chatId,
          from_message_id: 0,
          offset: 0,
          limit: Math.min(limit, 100),
          only_local: false,
        })
      }

      const tdMessages: any[] = result.messages ?? []
      const messages: TgMessageEvent[] = []
      let skippedSender = 0

      for (const msg of tdMessages) {
        // When fromMessageId is given, TDLib includes that message in the result — skip exact match
        if (fromMessageId && msg.id === fromMessageId) continue

        // For private 1-on-1 chats, is_outgoing is reliable even when the sender shape
        // is unusual (forwarded, service messages, etc.). Only skip if it's clearly a channel post.
        if (msg.sender_id?._ === 'messageSenderChat') {
          skippedSender++
          continue
        }

        messages.push({
          chatId: msg.chat_id,
          messageId: msg.id,
          isOutgoing: !!msg.is_outgoing,
          client: {
            telegramId: chatId,
            firstName: user.first_name || 'Unknown',
            lastName: user.last_name || undefined,
            username: user.usernames?.active_usernames?.[0] ?? user.username ?? undefined,
          },
          content: parseContent(msg.content),
          date: msg.date,
        })
      }

      console.log(
        `[tg-worker] history chat=${chatId} from=${fromMessageId} ` +
        `→ ${messages.length} msgs (raw=${tdMessages.length}, skipped=${skippedSender})`
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
