import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import type { TgMessageEvent } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { ChatsService } from './chats.service'

@Processor(REDIS_QUEUES.tgIncoming)
export class ChatsProcessor extends WorkerHost {
  constructor(private readonly chatsService: ChatsService) {
    super()
  }

  async process(job: Job<TgMessageEvent>): Promise<void> {
    await this.chatsService.processIncomingEvent(job.data)
  }
}
