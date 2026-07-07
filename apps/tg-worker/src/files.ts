import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { TgFileRequestJob, TgFileResponse } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

/** Map our shared content-type strings to TDLib's FileType discriminated union. */
function tdlibFileType(contentType: TgFileRequestJob['contentType']): { _: string } {
  switch (contentType) {
    case 'photo':     return { _: 'fileTypePhoto' }
    case 'video':     return { _: 'fileTypeVideo' }
    case 'videoNote': return { _: 'fileTypeVideoNote' }
    case 'voice':     return { _: 'fileTypeVoiceNote' }
    case 'document':  return { _: 'fileTypeDocument' }
    case 'sticker':   return { _: 'fileTypeSticker' }
    default:          return { _: 'fileTypeUnknown' }
  }
}

export function setupFileWorker(client: any) {
  const worker = new Worker<TgFileRequestJob, TgFileResponse>(
    REDIS_QUEUES.tgFileRequest,
    async (job: Job<TgFileRequestJob, TgFileResponse>) => {
      const { fileId, remoteFileId, contentType } = job.data
      try {
        // Local file IDs are session-scoped and get reused across sessions.
        // Rule: if we have a stable remoteFileId we MUST resolve through it —
        // falling back to the URL's local id after a failed resolve is what
        // caused the "wrong photo in wrong chat" bug. TDLib reused id 12345
        // for a different file after re-auth; serving that content pushed a
        // random cached image into the caller's message. Failing loudly (404
        // in the browser) is safer than serving mismatched media.
        let actualFileId: number
        if (remoteFileId) {
          try {
            const remoteFile = await client.invoke({
              _: 'getRemoteFile',
              remote_file_id: remoteFileId,
              // TDLib aborts (SIGABRT) on fileTypeNone for some remote IDs —
              // pass the actual type derived from the message's content type.
              file_type: tdlibFileType(contentType),
            })
            if (!remoteFile?.id) {
              console.warn(`[tg-worker] getRemoteFile returned no id for ${remoteFileId} — refusing to fall back to stale local id`)
              return { path: null }
            }
            actualFileId = remoteFile.id
          } catch (e) {
            console.warn(`[tg-worker] getRemoteFile failed for ${remoteFileId}: ${(e as Error).message} — NOT falling back to stale local id`)
            return { path: null }
          }
        } else {
          // No remoteFileId in the message (legacy content or a fresh event
          // where TDLib hadn't populated .remote yet). Trust the local id
          // — for freshly-downloaded messages it's still valid this session.
          actualFileId = fileId
        }

        const file = await client.invoke({
          _: 'downloadFile',
          file_id: actualFileId,
          priority: 1,
          offset: 0,
          limit: 0,
          synchronous: true,
        })
        const path = file?.local?.path ?? null
        if (path) console.log(`[tg-worker] file ${actualFileId} → ${path}`)
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
