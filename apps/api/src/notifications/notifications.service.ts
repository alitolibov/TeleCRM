import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as webpush from 'web-push'
import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'

export interface PushPayload {
  title: string
  body: string
  /** Opens this chat when the notification is clicked. */
  chatId?: string
  /** Collapses repeated notifications for the same chat (one per conversation). */
  tag?: string
}

export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private enabled = false

  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    const pub = this.config.get<string>('VAPID_PUBLIC_KEY')
    const priv = this.config.get<string>('VAPID_PRIVATE_KEY')
    const subject = this.config.get<string>('VAPID_SUBJECT') ?? 'mailto:admin@telecrm.local'
    if (pub && priv) {
      webpush.setVapidDetails(subject, pub, priv)
      this.enabled = true
    } else {
      console.warn('[push] VAPID keys not set — browser push disabled')
    }
  }

  getPublicKey(): string | null {
    return this.config.get<string>('VAPID_PUBLIC_KEY') ?? null
  }

  /** Register (or refresh) a browser push subscription for the user. */
  async subscribe(userId: string, sub: PushSubscriptionInput) {
    // An endpoint is globally unique to a browser/device — drop any stale row
    // (e.g. it belonged to a previously logged-in user) before inserting.
    await this.db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, sub.endpoint))
    await this.db.insert(schema.pushSubscriptions).values({
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    })
    return { ok: true }
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.db.delete(schema.pushSubscriptions).where(
      and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint)),
    )
  }

  async sendToUser(userId: string, payload: PushPayload) {
    if (!this.enabled) return
    const subs = await this.db.query.pushSubscriptions.findMany({
      where: (s, { eq }) => eq(s.userId, userId),
    })
    await Promise.all(subs.map((s) => this.sendOne(s, payload)))
  }

  async sendToUsers(userIds: string[], payload: PushPayload) {
    await Promise.all(userIds.map((id) => this.sendToUser(id, payload)))
  }

  async sendToAdmins(payload: PushPayload) {
    const admins = await this.db.query.users.findMany({
      where: (u, { eq, and, isNull }) => and(eq(u.role, 'admin'), isNull(u.deletedAt)),
      columns: { id: true },
    })
    await this.sendToUsers(admins.map((a) => a.id), payload)
  }

  private async sendOne(sub: typeof schema.pushSubscriptions.$inferSelect, payload: PushPayload) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      )
    } catch (e: any) {
      // 404/410 → the subscription is gone (unsubscribed / browser cleared). Prune it.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await this.db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id))
      } else {
        console.error('[push] send failed:', e?.statusCode, e?.body ?? e?.message)
      }
    }
  }
}
