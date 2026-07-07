import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { TgFileRequestJob, TgFileResponse } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

/** Persistent media mirror — a snapshot of every successfully-resolved file
 *  keyed by SHA-256(remoteFileId ?? "local:"+fileId). Survives TDLib chat
 *  deletions and re-auth session churn. Both api and tg-worker mount the
 *  same tdlib_data volume, so a file written here is immediately servable
 *  via /files/:id from the api side. */
const MEDIA_DIR = process.env.MEDIA_DIR ?? '/data/media'
try { mkdirSync(MEDIA_DIR, { recursive: true }) } catch { /* ignore — /data might be read-only in dev */ }

function mirrorKey(remoteFileId: string | undefined, fileId: number): string {
  const seed = remoteFileId ?? `local:${fileId}`
  return createHash('sha256').update(seed).digest('hex')
}

// Fixed extension per content type — never derived from TDLib's on-disk path,
// so the fast-path guess (before download) and the post-download mirror path
// are identical for a given (remoteFileId, contentType) pair.
function mirrorExtFor(contentType: TgFileRequestJob['contentType']): string {
  switch (contentType) {
    case 'photo':     return '.jpg'
    case 'video':     return '.mp4'
    case 'videoNote': return '.mp4'
    case 'voice':     return '.oga'
    case 'sticker':   return '.webp'
    case 'document':  return '.bin'
    default:          return '.bin'
  }
}

function mirrorPath(remoteFileId: string | undefined, fileId: number, contentType: TgFileRequestJob['contentType']): string {
  return join(MEDIA_DIR, mirrorKey(remoteFileId, fileId) + mirrorExtFor(contentType))
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
        // Fast path: we've already mirrored this file into our own storage,
        // serve it straight from there — no TDLib round-trip, no chance of
        // touching a stale local id, works even if TG has since deleted the
        // source chat. Only miss when the file has never been resolved
        // successfully before.
        const mirror = mirrorPath(remoteFileId, fileId, contentType)
        if (existsSync(mirror)) {
          return { path: mirror }
        }

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
        if (!path) return { path: null }

        // Mirror to our own storage so subsequent requests bypass TDLib and
        // survive chat-deletions / re-auths. Best-effort — a failed copy
        // still lets us serve THIS request via the TDLib path.
        try {
          if (!existsSync(mirror)) copyFileSync(path, mirror)
          console.log(`[tg-worker] file ${actualFileId} → ${path} (mirrored to ${mirror})`)
          return { path: mirror }
        } catch (e) {
          console.warn(`[tg-worker] mirror copy failed for ${path}: ${(e as Error).message}`)
          return { path }
        }
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
