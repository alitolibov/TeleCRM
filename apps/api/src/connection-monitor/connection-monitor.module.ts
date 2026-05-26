import { Module } from '@nestjs/common'
import { ConnectionMonitorService } from './connection-monitor.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { ChatsModule } from '../chats/chats.module'

@Module({
  imports: [NotificationsModule, ChatsModule],
  providers: [ConnectionMonitorService],
})
export class ConnectionMonitorModule {}
