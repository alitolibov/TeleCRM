import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { SettingsService } from './settings.service'
import { SettingsController } from './settings.controller'
import { EscalationService } from './escalation.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { ChatsModule } from '../chats/chats.module'

@Module({
  imports: [
    NotificationsModule,
    ChatsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow('JWT_ACCESS_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [SettingsController],
  providers: [SettingsService, EscalationService],
  exports: [SettingsService],
})
export class SettingsModule {}
