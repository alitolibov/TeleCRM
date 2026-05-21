import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue, QueueEvents } from 'bullmq'
import { ConfigService } from '@nestjs/config'
import type { TgFileRequestJob, TgFileResponse } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'

@Injectable()
export class FilesService implements OnModuleInit, OnModuleDestroy {
  private events!: QueueEvents

  constructor(
    @InjectQueue(REDIS_QUEUES.tgFileRequest) private queue: Queue<TgFileRequestJob, TgFileResponse>,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    const url = new URL(this.configService.get('REDIS_URL', 'redis://localhost:6379'))
    this.events = new QueueEvents(REDIS_QUEUES.tgFileRequest, {
      connection: { host: url.hostname, port: Number(url.port) || 6379 },
    })
  }

  async onModuleDestroy() {
    await this.events?.close().catch(() => {})
  }

  /** Triggers tg-worker to download a Telegram file. Returns the local path or null. */
  async resolveFile(fileId: number, remoteFileId?: string): Promise<string | null> {
    const job = await this.queue.add('download', { fileId, remoteFileId }, {
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
