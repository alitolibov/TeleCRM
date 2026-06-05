import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import type {
  TgMessageEvent,
  TgReadSyncEvent,
  TgMessageEditedEvent,
  TgMessageDeletedEvent,
  TgMessageIdRemapEvent,
  TgMessagePinnedEvent,
  TgUserStatusEvent,
  TgOutboxReadEvent,
  TgChatActionEvent,
} from '@telecrm/shared'
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

@Processor(REDIS_QUEUES.tgReadSync)
export class ChatsReadSyncProcessor extends WorkerHost {
  constructor(private readonly chatsService: ChatsService) {
    super()
  }

  async process(job: Job<TgReadSyncEvent>): Promise<void> {
    await this.chatsService.applyExternalRead(job.data)
  }
}

@Processor(REDIS_QUEUES.tgIncomingEdited)
export class ChatsEditedProcessor extends WorkerHost {
  constructor(private readonly chatsService: ChatsService) {
    super()
  }

  async process(job: Job<TgMessageEditedEvent>): Promise<void> {
    await this.chatsService.applyExternalEdit(job.data)
  }
}

@Processor(REDIS_QUEUES.tgIncomingDeleted)
export class ChatsDeletedProcessor extends WorkerHost {
  constructor(private readonly chatsService: ChatsService) {
    super()
  }

  async process(job: Job<TgMessageDeletedEvent>): Promise<void> {
    await this.chatsService.applyExternalDelete(job.data)
  }
}

@Processor(REDIS_QUEUES.tgIdRemap)
export class ChatsIdRemapProcessor extends WorkerHost {
  constructor(private readonly chatsService: ChatsService) {
    super()
  }

  async process(job: Job<TgMessageIdRemapEvent>): Promise<void> {
    await this.chatsService.remapMessageId(job.data)
  }
}

@Processor(REDIS_QUEUES.tgIncomingPinned)
export class ChatsPinnedProcessor extends WorkerHost {
  constructor(private readonly chatsService: ChatsService) {
    super()
  }

  async process(job: Job<TgMessagePinnedEvent>): Promise<void> {
    await this.chatsService.applyExternalPin(job.data)
  }
}

@Processor(REDIS_QUEUES.tgUserStatus)
export class ChatsUserStatusProcessor extends WorkerHost {
  constructor(private readonly chatsService: ChatsService) {
    super()
  }

  async process(job: Job<TgUserStatusEvent>): Promise<void> {
    await this.chatsService.applyUserStatus(job.data)
  }
}

@Processor(REDIS_QUEUES.tgOutboxRead)
export class ChatsOutboxReadProcessor extends WorkerHost {
  constructor(private readonly chatsService: ChatsService) {
    super()
  }

  async process(job: Job<TgOutboxReadEvent>): Promise<void> {
    await this.chatsService.applyOutboxRead(job.data)
  }
}

@Processor(REDIS_QUEUES.tgChatAction)
export class ChatsActionProcessor extends WorkerHost {
  constructor(private readonly chatsService: ChatsService) {
    super()
  }

  async process(job: Job<TgChatActionEvent>): Promise<void> {
    await this.chatsService.applyChatAction(job.data)
  }
}
