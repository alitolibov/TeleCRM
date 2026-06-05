import { Inject, Injectable, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { and, eq, gt, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import { SettingsService } from './settings.service'
import { NotificationsService } from '../notifications/notifications.service'
import { ChatsGateway } from '../chats/chats.gateway'

const SWEEP_INTERVAL_MS = 60 * 1000

type Kind = 'unpicked' | 'unanswered' | 'unclosed'

/**
 * Escalation sweeper (spec 7.3 / 10.2). Every minute it looks for:
 *  - 'new' chats not picked up within `escalationNewMinutes`
 *  - 'active' chats whose last message is from the client and unanswered for
 *    `escalationReplyMinutes`
 * and notifies the responsible manager first (level 1); if the situation
 * persists past 2× the threshold, it escalates to admins (level 2).
 * Already-sent escalations are deduped via the action_logs table.
 */
@Injectable()
export class EscalationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null

  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private settings: SettingsService,
    private notifications: NotificationsService,
    @Optional() private gateway?: ChatsGateway,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((e) => console.error('[escalation] sweep failed:', e))
    }, SWEEP_INTERVAL_MS)
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private async sweep() {
    const cfg = await this.settings.get()
    const now = Date.now()
    await this.sweepUnpicked(cfg.escalationNewMinutes, now)
    await this.sweepUnanswered(cfg.escalationReplyMinutes, now)
    await this.sweepUnclosed(cfg.escalationUnclosedMinutes, now)
  }

  /** 'new' chats sitting in the queue past the threshold. */
  private async sweepUnpicked(minutes: number, now: number) {
    const cutoff = new Date(now - minutes * 60_000)
    const rows = await this.db.execute<{
      id: string; assigned_to: string | null; ref: Date; first_name: string; last_name: string | null
    }>(sql`
      SELECT c.id, c.assigned_to, COALESCE(c.last_message_at, c.created_at) AS ref,
             cl.first_name, cl.last_name
      FROM ${schema.chats} c
      JOIN ${schema.clients} cl ON cl.id = c.client_id
      WHERE c.status = 'new' AND COALESCE(c.last_message_at, c.created_at) < ${cutoff}
    `)
    for (const r of rows.rows) {
      const ref = new Date(r.ref)
      const ageMin = (now - ref.getTime()) / 60_000
      const level = ageMin >= minutes * 2 ? 2 : 1
      await this.escalate({
        chatId: r.id, assignedTo: r.assigned_to, kind: 'unpicked', level, ref,
        clientName: this.name(r.first_name, r.last_name), minutes,
      })
    }
  }

  /** 'active' chats whose last message is from the client and went unanswered. */
  private async sweepUnanswered(minutes: number, now: number) {
    const cutoff = new Date(now - minutes * 60_000)
    const rows = await this.db.execute<{
      id: string; assigned_to: string | null; ref: Date; first_name: string; last_name: string | null
    }>(sql`
      SELECT c.id, c.assigned_to, m.created_at AS ref, cl.first_name, cl.last_name
      FROM ${schema.chats} c
      JOIN ${schema.clients} cl ON cl.id = c.client_id
      JOIN LATERAL (
        SELECT created_at, sender_type FROM ${schema.messages}
        WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1
      ) m ON TRUE
      WHERE c.status = 'active' AND m.sender_type = 'client' AND m.created_at < ${cutoff}
    `)
    for (const r of rows.rows) {
      const ref = new Date(r.ref)
      const ageMin = (now - ref.getTime()) / 60_000
      const level = ageMin >= minutes * 2 ? 2 : 1
      await this.escalate({
        chatId: r.id, assignedTo: r.assigned_to, kind: 'unanswered', level, ref,
        clientName: this.name(r.first_name, r.last_name), minutes,
      })
    }
  }

  /** 'active' chats that have been open longer than the threshold without being
   *  closed. Reference time is when the manager first responded (so the timer
   *  measures actual handling duration), falling back to created_at. */
  private async sweepUnclosed(minutes: number, now: number) {
    const cutoff = new Date(now - minutes * 60_000)
    const rows = await this.db.execute<{
      id: string; assigned_to: string | null; ref: Date; first_name: string; last_name: string | null
    }>(sql`
      SELECT c.id, c.assigned_to,
             COALESCE(c.first_response_at, c.created_at) AS ref,
             cl.first_name, cl.last_name
      FROM ${schema.chats} c
      JOIN ${schema.clients} cl ON cl.id = c.client_id
      WHERE c.status = 'active'
        AND COALESCE(c.first_response_at, c.created_at) < ${cutoff}
    `)
    for (const r of rows.rows) {
      const ref = new Date(r.ref)
      const ageMin = (now - ref.getTime()) / 60_000
      const level = ageMin >= minutes * 2 ? 2 : 1
      await this.escalate({
        chatId: r.id, assignedTo: r.assigned_to, kind: 'unclosed', level, ref,
        clientName: this.name(r.first_name, r.last_name), minutes,
      })
    }
  }

  private name(first: string, last: string | null) {
    return [first, last].filter(Boolean).join(' ') || 'Клиент'
  }

  private async escalate(p: {
    chatId: string; assignedTo: string | null; kind: Kind; level: 1 | 2; ref: Date; clientName: string; minutes: number
  }) {
    // Dedup: skip if we've already escalated this chat at this level since the
    // reference time (advances when the client writes again → may re-escalate).
    const existing = await this.db
      .select({ id: schema.actionLogs.id })
      .from(schema.actionLogs)
      .where(and(
        eq(schema.actionLogs.chatId, p.chatId),
        eq(schema.actionLogs.action, 'chat_escalated'),
        sql`${schema.actionLogs.metadata}->>'kind' = ${p.kind}`,
        sql`${schema.actionLogs.metadata}->>'level' = ${String(p.level)}`,
        gt(schema.actionLogs.createdAt, p.ref),
      ))
      .limit(1)
    if (existing.length > 0) return

    // Level 1 → first reminder to the manager; level 2 → escalated to admins.
    const longText: Record<Kind, string> = {
      unpicked:   `Всё ещё не взят в работу (>${p.minutes * 2} мин) — эскалация руководителю`,
      unanswered: `Клиент всё ещё без ответа (>${p.minutes * 2} мин) — эскалация руководителю`,
      unclosed:   `Чат всё ещё не закрыт (>${p.minutes * 2} мин) — эскалация руководителю`,
    }
    const shortText: Record<Kind, string> = {
      unpicked:   `Не взят в работу более ${p.minutes} мин`,
      unanswered: `Клиент ждёт ответа более ${p.minutes} мин`,
      unclosed:   `Чат в работе более ${p.minutes} мин и не закрыт`,
    }
    const body = p.level >= 2 ? longText[p.kind] : shortText[p.kind]

    // Resolve recipients: level 1 → the responsible manager (if any), otherwise
    // (and always at level 2) → admins. Used for both push and the in-app toast.
    let recipientIds: string[]
    if (p.level === 1 && p.assignedTo) {
      recipientIds = [p.assignedTo]
    } else {
      const admins = await this.db.query.users.findMany({
        where: (u, { eq, and, isNull }) => and(eq(u.role, 'admin'), isNull(u.deletedAt)),
        columns: { id: true },
      })
      recipientIds = admins.map((a) => a.id)
    }

    console.log(`[escalation] ${p.kind} L${p.level} chat=${p.chatId} → ${recipientIds.length} recipient(s) ("${body}")`)

    const title = p.level >= 2 ? `Эскалация ↑ руководителю: ${p.clientName}` : `Эскалация: ${p.clientName}`
    // Browser push (force → shown even if a CRM tab is focused, since escalations
    // have no in-app equivalent like the new-message sound/badge).
    await this.notifications.sendToUsers(recipientIds, {
      title: `⏰ ${title}`, body, chatId: p.chatId, tag: `esc:${p.chatId}:${p.level}`, force: true,
    })
    // In-app notification over WS — reliable regardless of OS notification settings.
    this.gateway?.emitToUsers(recipientIds, 'notify', {
      type: 'escalation',
      title,
      body,
      chatId: p.chatId,
      level: p.level,
    })

    await this.db.insert(schema.actionLogs).values({
      action: 'chat_escalated',
      actorId: null,
      chatId: p.chatId,
      metadata: { kind: p.kind, level: p.level, minutes: p.minutes },
    }).catch(() => {})
  }
}
