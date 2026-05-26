import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core'

/**
 * Single-row, org-wide configuration. Currently holds the escalation timeouts
 * (spec 7.3 — "Таймауты настраиваются администратором").
 */
export const appSettings = pgTable('app_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Minutes a 'new' chat may sit unpicked before escalating. */
  escalationNewMinutes: integer('escalation_new_minutes').notNull().default(15),
  /** Minutes a manager may leave a client message unanswered before escalating. */
  escalationReplyMinutes: integer('escalation_reply_minutes').notNull().default(30),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AppSettings = typeof appSettings.$inferSelect
