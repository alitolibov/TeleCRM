import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ChatsController } from './chats.controller'
import { ChatsService } from './chats.service'
import { ChatsProcessor } from './chats.processor'
import { ChatsGateway } from './chats.gateway'
import { REDIS_QUEUES } from '@telecrm/shared'

@Module({
  imports: [
    BullModule.registerQueue(
      { name: REDIS_QUEUES.tgIncoming },
      { name: REDIS_QUEUES.tgOutgoing },
    ),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ChatsController],
  providers: [ChatsService, ChatsProcessor, ChatsGateway],
})
export class ChatsModule {}
