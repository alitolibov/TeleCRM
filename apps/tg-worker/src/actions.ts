import { Worker } from 'bullmq'
import type {
  TgPinJob,
  TgForwardJob,
  TgChatSearchRequest,
  TgChatSearchResponse,
  TgChatSearchResult,
} from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'
import { getTgUser } from './messages.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

/**
 * Three TDLib actions exposed to the API:
 *   · pinChatMessage / unpinChatMessage — closes/opens a pin in the TG chat,
 *     visible to the client too;
 *   · forwardMessages — sends existing TG messages into any TG chat we have
 *     access to (favourites of the CRM account, groups, channels, private);
 *   · searchChats — local-then-server hybrid lookup that powers the forward
 *     picker so the team can type a few letters and pick.
 */
export function setupActionWorkers(client: any) {
  const pinWorker = new Worker<TgPinJob>(
    REDIS_QUEUES.tgPin,
    async (job) => {
      const { chatId, messageId, pin } = job.data
      if (pin) {
        await client.invoke({
          _: 'pinChatMessage',
          chat_id: chatId,
          message_id: messageId,
          // Notify the chat (client sees the pin) — silent mode would suppress
          // the system notice, which feels off for a "pin" action.
          disable_notification: false,
          only_for_self: false,
        })
      } else {
        await client.invoke({
          _: 'unpinChatMessage',
          chat_id: chatId,
          message_id: messageId,
        })
      }
    },
    { connection: buildRedisConnection(), concurrency: 2 },
  )
  pinWorker.on('completed', (job) =>
    console.log(`[tg-worker] ${job.data.pin ? '📌 pinned' : '↺ unpinned'} msg ${job.data.messageId} in chat ${job.data.chatId}`),
  )
  pinWorker.on('failed', (job, err) =>
    console.error(`[tg-worker] pin failed (msg ${job?.data.messageId}):`, err.message),
  )

  const forwardWorker = new Worker<TgForwardJob>(
    REDIS_QUEUES.tgForward,
    async (job) => {
      const { fromChatId, messageIds, toChatId } = job.data
      // openChat on the destination first — TDLib otherwise refuses forwards
      // to channels/groups the worker hasn't been "viewing" recently.
      await client.invoke({ _: 'openChat', chat_id: toChatId }).catch(() => {})
      await client.invoke({
        _: 'forwardMessages',
        chat_id: toChatId,
        from_chat_id: fromChatId,
        message_ids: messageIds,
        // Faux-Telegram defaults: keep the original sender header, no protect
        // content (the team can always re-forward), no caption changes.
        send_copy: false,
        remove_caption: false,
      })
      await client.invoke({ _: 'closeChat', chat_id: toChatId }).catch(() => {})
    },
    { connection: buildRedisConnection(), concurrency: 2 },
  )
  forwardWorker.on('completed', (job) =>
    console.log(`[tg-worker] ↪ forwarded ${job.data.messageIds.length} msg(s) → chat ${job.data.toChatId}`),
  )
  forwardWorker.on('failed', (job, err) =>
    console.error(`[tg-worker] forward failed (→ chat ${job?.data.toChatId}):`, err.message),
  )

  const searchWorker = new Worker<TgChatSearchRequest, TgChatSearchResponse>(
    REDIS_QUEUES.tgChatSearch,
    async (job) => {
      const { q, limit = 20 } = job.data
      const seen = new Set<number>()
      const items: TgChatSearchResult[] = []

      // Local first — instant hits from already-loaded chats.
      const local = await client.invoke({ _: 'searchChats', query: q, limit }).catch(() => null)
      if (local?.chat_ids) await collect(client, local.chat_ids, items, seen)

      // Then a server search to find chats we haven't opened yet (only when
      // there's a query — empty `q` is meaningless on the server).
      if (q.trim().length > 0 && items.length < limit) {
        const remote = await client.invoke({ _: 'searchChatsOnServer', query: q, limit }).catch(() => null)
        if (remote?.chat_ids) await collect(client, remote.chat_ids, items, seen, limit)
      }
      return { items: items.slice(0, limit) }
    },
    { connection: buildRedisConnection(), concurrency: 2 },
  )
  searchWorker.on('failed', (job, err) =>
    console.error(`[tg-worker] chat search failed (q="${job?.data.q}"):`, err.message),
  )

  return { pinWorker, forwardWorker, searchWorker }
}

async function collect(
  client: any,
  chatIds: number[],
  out: TgChatSearchResult[],
  seen: Set<number>,
  cap = Infinity,
) {
  for (const id of chatIds) {
    if (out.length >= cap || seen.has(id)) continue
    seen.add(id)
    const chat = await client.invoke({ _: 'getChat', chat_id: id }).catch(() => null)
    if (!chat) continue
    const type = mapChatType(chat.type?._)
    let username: string | undefined
    if (type === 'user') {
      // Pull the live user for username — chat.title is "First Last" without it.
      const user = await getTgUser(client, id).catch(() => null)
      username = user?.usernames?.active_usernames?.[0] ?? user?.username ?? undefined
    } else {
      username = chat.usernames?.active_usernames?.[0] ?? undefined
    }
    out.push({ id, title: chat.title || '—', type, username })
  }
}

function mapChatType(t: string | undefined): TgChatSearchResult['type'] {
  switch (t) {
    case 'chatTypePrivate':    return 'user'
    case 'chatTypeBasicGroup': return 'group'
    case 'chatTypeSupergroup': return 'group'
    case 'chatTypeChannel':    return 'channel'
    default:                   return 'other'
  }
}
