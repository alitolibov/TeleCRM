import { Inject, Injectable } from '@nestjs/common'
import { and, eq, desc, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import type { ListLogsDto } from './dto/list-logs.dto'

/** Action-log viewer (spec 13) — admin only. */
@Injectable()
export class LogsService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  async list(opts: ListLogsDto) {
    const limit = Math.min(Math.max(parseInt(opts.limit ?? '50', 10) || 50, 1), 100)
    const offset = Math.max(parseInt(opts.offset ?? '0', 10) || 0, 0)

    const actor = alias(schema.users, 'actor')
    const target = alias(schema.users, 'target_user')

    const conds: any[] = []
    if (opts.action) conds.push(eq(schema.actionLogs.action, opts.action as any))
    if (opts.actorId) conds.push(eq(schema.actionLogs.actorId, opts.actorId))
    if (opts.dateFrom) conds.push(sql`${schema.actionLogs.createdAt} >= ${new Date(opts.dateFrom)}`)
    if (opts.dateTo) conds.push(sql`${schema.actionLogs.createdAt} <= ${new Date(opts.dateTo)}`)

    const rows = await this.db
      .select({
        id: schema.actionLogs.id,
        action: schema.actionLogs.action,
        metadata: schema.actionLogs.metadata,
        createdAt: schema.actionLogs.createdAt,
        actorName: actor.firstName,
        targetName: target.firstName,
        clientName: schema.clients.firstName,
        clientUsername: schema.clients.username,
      })
      .from(schema.actionLogs)
      .leftJoin(actor, eq(actor.id, schema.actionLogs.actorId))
      .leftJoin(target, eq(target.id, schema.actionLogs.targetUserId))
      .leftJoin(schema.chats, eq(schema.chats.id, schema.actionLogs.chatId))
      .leftJoin(schema.clients, eq(schema.clients.id, schema.chats.clientId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.actionLogs.createdAt))
      .limit(limit)
      .offset(offset)

    return { items: rows, hasMore: rows.length === limit }
  }
}
