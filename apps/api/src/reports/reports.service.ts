import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'

/** Manager analytics (spec 12). All metrics are scoped to a [from, to] window. */
@Injectable()
export class ReportsService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  async getReport(from: Date, to: Date) {
    const summaryRows = await this.db.execute<{
      closed_chats: string
      new_clients: string
      avg_first_response: string | null
      avg_close: string | null
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM ${schema.actionLogs}
           WHERE action = 'chat_status_changed' AND metadata->>'to' = 'closed'
             AND created_at BETWEEN ${from} AND ${to})::text AS closed_chats,
        (SELECT COUNT(*) FROM ${schema.clients}
           WHERE created_at BETWEEN ${from} AND ${to})::text AS new_clients,
        (SELECT AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))) FROM ${schema.chats}
           WHERE first_response_at IS NOT NULL AND first_response_at BETWEEN ${from} AND ${to}) AS avg_first_response,
        (SELECT AVG(EXTRACT(EPOCH FROM (closed_at - created_at))) FROM ${schema.chats}
           WHERE closed_at IS NOT NULL AND closed_at BETWEEN ${from} AND ${to}) AS avg_close
    `)
    const summary = summaryRows.rows[0]

    // Per-employee: current open load + chats they closed in the window.
    const byEmployee = await this.db.execute<{
      id: string; first_name: string; last_name: string | null
      active_chats: string; closed_in_period: string
    }>(sql`
      SELECT u.id, u.first_name, u.last_name,
        COALESCE(ac.cnt, 0)::text AS active_chats,
        COALESCE(cl.cnt, 0)::text AS closed_in_period
      FROM ${schema.users} u
      LEFT JOIN (
        SELECT assigned_to, COUNT(*) AS cnt FROM ${schema.chats}
        WHERE status IN ('new', 'active') AND assigned_to IS NOT NULL
        GROUP BY assigned_to
      ) ac ON ac.assigned_to = u.id
      LEFT JOIN (
        SELECT actor_id, COUNT(*) AS cnt FROM ${schema.actionLogs}
        WHERE action = 'chat_status_changed' AND metadata->>'to' = 'closed'
          AND created_at BETWEEN ${from} AND ${to}
        GROUP BY actor_id
      ) cl ON cl.actor_id = u.id
      WHERE u.deleted_at IS NULL
      ORDER BY u.first_name ASC
    `)

    const num = (v: string | null | undefined) => (v != null ? Math.round(Number(v)) : null)

    return {
      closedChats: Number(summary?.closed_chats ?? 0),
      newClients: Number(summary?.new_clients ?? 0),
      avgFirstResponseSec: num(summary?.avg_first_response),
      avgCloseSec: num(summary?.avg_close),
      byEmployee: byEmployee.rows.map((r) => ({
        userId: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        activeChats: Number(r.active_chats),
        closedInPeriod: Number(r.closed_in_period),
      })),
    }
  }
}
