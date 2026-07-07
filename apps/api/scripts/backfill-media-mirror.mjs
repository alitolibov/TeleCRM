/**
 * One-shot: walk every media message and ask the file worker to resolve it
 * once — the new worker code writes each resolved file into /data/media
 * keyed by SHA-256(remoteFileId). After this the CRM has its own snapshot
 * of every reachable media file, and future /files/:id requests hit our
 * mirror instead of TDLib's session-scoped cache. Files whose remote id
 * TDLib can no longer resolve are silently skipped — nothing we can do
 * about those, the TG-side data is gone.
 *
 *   docker exec -i telecrm-api-1 sh -c 'cd /app && node /app/backfill.mjs'
 */
import { Pool } from 'pg'
import { Queue, QueueEvents } from 'bullmq'

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is required'); process.exit(1) }
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379')
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 }

const FILE_QUEUE = 'tg-file-request'
const CONCURRENCY = 4
const PER_JOB_TIMEOUT_MS = 45_000

async function main() {
  const pool = new Pool({ connectionString: url })
  const queue = new Queue(FILE_QUEUE, { connection })
  const events = new QueueEvents(FILE_QUEUE, { connection })

  // Newest first — the recently-active chats are what people are actually
  // scrolling through right now, so mirror those before the ancient archive.
  const { rows } = await pool.query(`
    SELECT id,
           (content->>'fileId')::bigint AS file_id,
           content->>'remoteFileId'      AS remote_file_id,
           content->>'type'              AS content_type
    FROM messages
    WHERE content->>'fileId' IS NOT NULL
      AND content->>'type' IN ('photo','video','videoNote','voice','sticker','document')
    ORDER BY created_at DESC
  `)
  console.log(`[backfill] ${rows.length} media messages`)

  let mirrored = 0, skipped = 0, failed = 0

  // Batches of CONCURRENCY jobs run in parallel — the file worker is set to
  // concurrency 4, and going higher just fills BullMQ's wait list.
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(batch.map(async (m) => {
      const job = await queue.add('download', {
        fileId: Number(m.file_id),
        remoteFileId: m.remote_file_id ?? undefined,
        contentType: m.content_type,
      }, { removeOnComplete: 100, removeOnFail: 50 })
      const res = await job.waitUntilFinished(events, PER_JOB_TIMEOUT_MS)
      return { path: res?.path ?? null, msg: m }
    }))

    for (const r of results) {
      if (r.status === 'rejected') { failed++; continue }
      if (!r.value.path) { skipped++; continue }
      // The worker returns /data/media/... when the mirror was written this
      // run OR was already present. Anything else means it fell back to the
      // TDLib cache path (mirror copy failed) — count as skipped for our
      // purposes since it's not yet in our storage.
      if (r.value.path.startsWith('/data/media/')) mirrored++
      else skipped++
    }

    if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= rows.length) {
      console.log(`[backfill] ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length} — mirrored=${mirrored} skipped=${skipped} failed=${failed}`)
    }
  }

  console.log(`[backfill] done — mirrored=${mirrored} skipped=${skipped} failed=${failed}`)

  await queue.close()
  await events.close()
  await pool.end()
}

main().catch((err) => { console.error('[backfill] fatal:', err); process.exit(1) })
