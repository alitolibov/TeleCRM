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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Extract the wait time (seconds) from a Telegram FLOOD_WAIT / 429 error, else 0. */
function floodWaitSeconds(e: any): number {
  const msg = `${e?.message ?? e?.text ?? ''}`
  const m = msg.match(/retry after (\d+)/i) || msg.match(/FLOOD_WAIT_(\d+)/i)
  if (m) return Number(m[1])
  if (e?.code === 429 && typeof e?.retry_after === 'number') return e.retry_after
  return 0
}

/**
 * Invoke TDLib respecting rate limits (spec 3.5): on FLOOD_WAIT, wait the
 * requested interval and retry. The message stays "отправляется" in the CRM
 * until it actually goes through (the echo flips it to "sent").
 */
async function invokeWithFloodRetry(client: any, payload: any, attempt = 0): Promise<any> {
  try {
    return await client.invoke(payload)
  } catch (e) {
    const wait = floodWaitSeconds(e)
    if (wait > 0 && attempt < 5) {
      console.warn(`[tg-worker] FLOOD_WAIT ${wait}s — retry ${attempt + 1}/5`)
      await sleep((wait + 1) * 1000)
      return invokeWithFloodRetry(client, payload, attempt + 1)
    }
    throw e
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
        await invokeWithFloodRetry(client, buildPayload({
          _: 'inputMessageText',
          text: { _: 'formattedText', text: content.text, entities: [] },
        }))
        return
      }

      if (content.type === 'photo') {
        await invokeWithFloodRetry(client, buildPayload({
          _: 'inputMessagePhoto',
          photo: { _: 'inputFileLocal', path: content.filePath },
          caption: content.caption
            ? { _: 'formattedText', text: content.caption, entities: [] }
            : undefined,
        }))
        return
      }

      if (content.type === 'video') {
        await invokeWithFloodRetry(client, buildPayload({
          _: 'inputMessageVideo',
          video: { _: 'inputFileLocal', path: content.filePath },
          supports_streaming: true,
          caption: content.caption
            ? { _: 'formattedText', text: content.caption, entities: [] }
            : undefined,
        }))
        return
      }

      if (content.type === 'album') {
        // 2-10 photos/videos grouped as a media album. Caption rides on the
        // first item (Telegram shows one caption per album).
        const inputs = content.items.map((it, i) => {
          const cap = i === 0 && content.caption
            ? { _: 'formattedText', text: content.caption, entities: [] }
            : undefined
          return it.kind === 'video'
            ? { _: 'inputMessageVideo', video: { _: 'inputFileLocal', path: it.filePath }, supports_streaming: true, caption: cap }
            : { _: 'inputMessagePhoto', photo: { _: 'inputFileLocal', path: it.filePath }, caption: cap }
        })
        await invokeWithFloodRetry(client, {
          _: 'sendMessageAlbum',
          chat_id: chatId,
          input_message_contents: inputs,
        })
        return
      }

      if (content.type === 'document') {
        await invokeWithFloodRetry(client, buildPayload({
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
      // Proactive pacing (spec 3.5): at most 1 outgoing message per second so a
      // burst (quick replies, many chats) can't trip Telegram's flood limits.
      // FLOOD_WAIT retry above is the reactive safety net on top of this.
      limiter: { max: 1, duration: 1000 },
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
