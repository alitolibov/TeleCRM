import { Inject, Injectable, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Redis } from 'ioredis'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { REDIS_CHANNELS } from '@telecrm/shared'
import type { TgConnectionEvent } from '@telecrm/shared'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import { NotificationsService } from '../notifications/notifications.service'
import { ChatsGateway } from '../chats/chats.gateway'

const ALERT_AFTER_MS = 2 * 60 * 1000   // spec 3.4 — alert if down longer than 2 minutes
const CHECK_INTERVAL_MS = 30 * 1000

/**
 * Watches the TDLib connection state (published by tg-worker over Redis) and
 * alerts admins if the link to Telegram stays down for more than 2 minutes
 * (spec 3.4 / 10.2).
 */
@Injectable()
export class ConnectionMonitorService implements OnModuleInit, OnModuleDestroy {
  private sub?: Redis
  private timer: NodeJS.Timeout | null = null
  private state: TgConnectionEvent['state'] = 'connected' // optimistic until first event
  private since = Date.now()
  private alerted = false

  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private config: ConfigService,
    private notifications: NotificationsService,
    @Optional() private gateway?: ChatsGateway,
  ) {}

  onModuleInit() {
    const url = this.config.get('REDIS_URL', 'redis://localhost:6379')
    this.sub = new Redis(url, { maxRetriesPerRequest: null })
    this.sub.subscribe(REDIS_CHANNELS.tgConnection).catch((e) => console.error('[conn] subscribe failed', e))
    this.sub.on('message', (_channel, raw) => {
      try { this.onEvent(JSON.parse(raw) as TgConnectionEvent) } catch { /* ignore */ }
    })
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
    await this.sub?.quit().catch(() => {})
  }

  private onEvent(event: TgConnectionEvent) {
    if (event.state === this.state) return
    this.state = event.state
    this.since = Date.now()
    if (event.state === 'connected' && this.alerted) {
      this.alerted = false
      this.notifyAdmins('✅ Связь с Telegram восстановлена', 'Соединение с Telegram снова активно.')
    }
  }

  private check() {
    if (this.state !== 'connected' && !this.alerted && Date.now() - this.since > ALERT_AFTER_MS) {
      this.alerted = true
      this.notifyAdmins('⚠️ Потеряна связь с Telegram', 'Нет соединения с Telegram дольше 2 минут — сообщения не отправляются и не приходят.')
    }
  }

  private async notifyAdmins(title: string, body: string) {
    try {
      const admins = await this.db.query.users.findMany({
        where: (u, { eq, and, isNull }) => and(eq(u.role, 'admin'), isNull(u.deletedAt)),
        columns: { id: true },
      })
      const ids = admins.map((a) => a.id)
      await this.notifications.sendToUsers(ids, { title, body, force: true })
      this.gateway?.emitToUsers(ids, 'notify', { type: 'system', title, body })
    } catch (e) {
      console.error('[conn] notifyAdmins failed', e)
    }
  }
}
