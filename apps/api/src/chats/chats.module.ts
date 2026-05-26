import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ChatsController } from './chats.controller'
import { ChatsService } from './chats.service'
import {
  ChatsProcessor,
  ChatsReadSyncProcessor,
  ChatsEditedProcessor,
  ChatsDeletedProcessor,
  ChatsIdRemapProcessor,
} from './chats.processor'
import { ChatsGateway } from './chats.gateway'
import { NotificationsModule } from '../notifications/notifications.module'
import { REDIS_QUEUES } from '@telecrm/shared'

@Module({
  imports: [
    BullModule.registerQueue(
      { name: REDIS_QUEUES.tgIncoming },
      { name: REDIS_QUEUES.tgOutgoing },
      { name: REDIS_QUEUES.tgHistoryRequest },
      { name: REDIS_QUEUES.tgReadSync },
      { name: REDIS_QUEUES.tgEdit },
      { name: REDIS_QUEUES.tgDelete },
      { name: REDIS_QUEUES.tgIncomingEdited },
      { name: REDIS_QUEUES.tgIncomingDeleted },
      { name: REDIS_QUEUES.tgIdRemap },
    ),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
      }),
      inject: [ConfigService],
    }),
    NotificationsModule,
  ],
  controllers: [ChatsController],
  providers: [
    ChatsService,
    ChatsProcessor,
    ChatsReadSyncProcessor,
    ChatsEditedProcessor,
    ChatsDeletedProcessor,
    ChatsIdRemapProcessor,
    ChatsGateway,
  ],
  exports: [ChatsService, ChatsGateway],
})
export class ChatsModule {}
