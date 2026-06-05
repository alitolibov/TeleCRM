import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Configurable list of "close chat" outcomes. Replaces the hard-coded
 * client_status enum so admins can manage outcomes from settings.
 * `value` is the stable machine key stored on chat_results.client_status.
 */
export const closeReasons = pgTable('close_reasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  value: varchar('value', { length: 50 }).notNull().unique(),
  label: varchar('label', { length: 100 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('close_reasons_sort_idx').on(t.sortOrder),
])

export type CloseReason = typeof closeReasons.$inferSelect
export type NewCloseReason = typeof closeReasons.$inferInsert
