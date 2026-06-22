/**
 * One-shot: walk every message whose content has fileId but is missing
 * remoteFileId. Ask tg-worker to refetch the message via TDLib's getMessage —
 * the response carries the current local id AND the stable remote id — then
 * rewrite the content jsonb in-place. After this, /files/:id can resolve
 * those photos/documents again even after re-auth.
 *
 *   docker exec -i telecrm-api-1 sh -c 'cd /app && node /tmp/heal.mjs'
 */
import { Pool } from 'pg'
import { Queue, QueueEvents } from 'bullmq'

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is required'); process.exit(1) }
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379')
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 }

const REFRESH_QUEUE = 'tg-refresh-message'

async function main() {
  const pool = new Pool({ connectionString: url })
  const queue = new Queue(REFRESH_QUEUE, { connection })
  const events = new QueueEvents(REFRESH_QUEUE, { connection })

  // Find every message that needs healing: has a local fileId, no remoteFileId.
  const { rows: msgs } = await pool.query(`
    SELECT m.id, m.telegram_message_id, cl.telegram_id::text AS chat_tg_id
    FROM messages m
    JOIN chats c ON c.id = m.chat_id
    JOIN clients cl ON cl.id = c.client_id
    WHERE m.content->>'fileId' IS NOT NULL
      AND m.content->>'remoteFileId' IS NULL
      AND m.telegram_message_id IS NOT NULL
    ORDER BY m.created_at DESC
  `)

  console.log(`[heal] ${msgs.length} messages need healing`)

  let healed = 0, skipped = 0, failed = 0

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    try {
      const job = await queue.add('refresh', {
        chatId: Number(m.chat_tg_id),
        messageId: Number(m.telegram_message_id),
      }, { removeOnComplete: 100, removeOnFail: 50 })

      const result = await job.waitUntilFinished(events, 15_000)
      if (!result?.content) {
        skipped++
        continue
      }

      // Only rewrite if the fresh content actually has a remoteFileId we
      // didn't have before — otherwise we'd just churn for no gain.
      if (!result.content.remoteFileId) {
        skipped++
        continue
      }

      await pool.query(
        `UPDATE messages SET content = $1::jsonb WHERE id = $2`,
        [JSON.stringify(result.content), m.id],
      )
      healed++
      if (healed % 25 === 0 || i === msgs.length - 1) {
        console.log(`[heal] ${i + 1}/${msgs.length} — healed=${healed} skipped=${skipped} failed=${failed}`)
      }
    } catch (e) {
      failed++
      if (failed <= 5 || failed % 50 === 0) {
        console.error(`[heal] ${i + 1}/${msgs.length} msg ${m.id}:`, e?.message ?? e)
      }
    }
  }

  console.log(`[heal] done — healed=${healed} skipped=${skipped} failed=${failed}`)

  await queue.close()
  await events.close()
  await pool.end()
}

main().catch((err) => { console.error('[heal] fatal:', err); process.exit(1) })
