import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { REDIS_QUEUES } from '@telecrm/shared'
import { ContactsService } from './contacts.service'
import { ContactsController } from './contacts.controller'

@Module({
  imports: [
    BullModule.registerQueue({ name: REDIS_QUEUES.tgAddContact }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow('JWT_ACCESS_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
