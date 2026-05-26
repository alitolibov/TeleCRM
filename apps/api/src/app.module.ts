import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { BullModule } from '@nestjs/bullmq'
import { DrizzleModule } from './db/drizzle.module'
import { UsersModule } from './users/users.module'
import { AuthModule } from './auth/auth.module'
import { ChatsModule } from './chats/chats.module'
import { FilesModule } from './files/files.module'
import { NotificationsModule } from './notifications/notifications.module'
import { SettingsModule } from './settings/settings.module'
import { QuickRepliesModule } from './quick-replies/quick-replies.module'
import { ReportsModule } from './reports/reports.module'
import { LogsModule } from './logs/logs.module'
import { ConnectionMonitorModule } from './connection-monitor/connection-monitor.module'
import { HealthController } from './health.controller'

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: '../../.env', isGlobal: true }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get('REDIS_URL', 'redis://localhost:6379'))
        return { connection: { host: url.hostname, port: Number(url.port) || 6379 } }
      },
      inject: [ConfigService],
    }),
    DrizzleModule,
    UsersModule,
    AuthModule,
    ChatsModule,
    FilesModule,
    NotificationsModule,
    SettingsModule,
    QuickRepliesModule,
    ReportsModule,
    LogsModule,
    ConnectionMonitorModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
