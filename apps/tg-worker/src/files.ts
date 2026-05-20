import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { TgFileRequestJob, TgFileResponse } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

export function setupFileWorker(client: any) {
  const worker = new Worker<TgFileRequestJob, TgFileResponse>(
    REDIS_QUEUES.tgFileRequest,
    async (job: Job<TgFileRequestJob, TgFileResponse>) => {
      const { fileId } = job.data
      try {
        // synchronous: true — wait until TDLib finishes downloading (or finds it locally)
        const file = await client.invoke({
          _: 'downloadFile',
          file_id: fileId,
          priority: 1,
          offset: 0,
          limit: 0,
          synchronous: true,
        })
        const path = file?.local?.path ?? null
        if (path) console.log(`[tg-worker] file ${fileId} → ${path}`)
        return { path }
      } catch (e) {
        console.error(`[tg-worker] download file ${fileId} failed:`, (e as Error).message)
        return { path: null }
      }
    },
    { connection: buildRedisConnection(), concurrency: 4 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[tg-worker] file job ${job?.id} failed:`, err.message)
  })

  return worker
}
