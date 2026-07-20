import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue, QueueEvents } from 'bullmq'
import { ConfigService } from '@nestjs/config'
import type { TgFileRequestJob, TgFileResponse, TgMessageContent } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'

@Injectable()
export class FilesService implements OnModuleInit, OnModuleDestroy {
  private events!: QueueEvents
  private refreshEvents!: QueueEvents

  constructor(
    @InjectQueue(REDIS_QUEUES.tgFileRequest) private queue: Queue<TgFileRequestJob, TgFileResponse>,
    @InjectQueue(REDIS_QUEUES.tgRefreshMessage) private refreshQueue: Queue,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    const url = new URL(this.configService.get('REDIS_URL', 'redis://localhost:6379'))
    const connection = { host: url.hostname, port: Number(url.port) || 6379 }
    this.events = new QueueEvents(REDIS_QUEUES.tgFileRequest, { connection })
    this.refreshEvents = new QueueEvents(REDIS_QUEUES.tgRefreshMessage, { connection })
  }

  /**
   * Re-fetches a message from TDLib to obtain a fresh `remoteFileId`.
   *
   * A remoteFileId embeds a `file_reference` — a short-lived token Telegram
   * invalidates over time and on re-auth. `getRemoteFile` still succeeds with
   * a stale one (it only decodes the string locally, no network), so the
   * breakage only surfaces later as "File download has failed or was
   * canceled" from downloadFile. The sole way to get a valid reference again
   * is to ask TDLib for the message anew.
   */
  async refreshContent(chatTgId: number, tgMessageId: number): Promise<TgMessageContent | null> {
    try {
      const job = await this.refreshQueue.add('refresh', { chatId: chatTgId, messageId: tgMessageId }, {
        removeOnComplete: 100,
        removeOnFail: 50,
      })
      const result = (await job.waitUntilFinished(this.refreshEvents, 20_000)) as { content?: TgMessageContent }
      return result?.content ?? null
    } catch {
      return null
    }
  }

  async onModuleDestroy() {
    await this.events?.close().catch(() => {})
    await this.refreshEvents?.close().catch(() => {})
  }

  /** Triggers tg-worker to download a Telegram file. Returns the local path or null. */
  async resolveFile(
    fileId: number,
    remoteFileId?: string,
    contentType?: TgFileRequestJob['contentType'],
  ): Promise<string | null> {
    const job = await this.queue.add('download', { fileId, remoteFileId, contentType }, {
      removeOnComplete: 100,
      removeOnFail: 50,
    })
    try {
      const result = (await job.waitUntilFinished(this.events, 60_000)) as TgFileResponse
      return result.path
    } catch {
      return null
    }
  }
}
