import { pgTable, uuid, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { actionType } from './enums'
import { users } from './users'
import { chats } from './chats'

export const actionLogs = pgTable('action_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  action: actionType('action').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  targetUserId: uuid('target_user_id').references(() => users.id),
  chatId: uuid('chat_id').references(() => chats.id),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('action_logs_actor_id_idx').on(t.actorId),
  index('action_logs_chat_id_idx').on(t.chatId),
  index('action_logs_created_at_idx').on(t.createdAt),
])

export type ActionLog = typeof actionLogs.$inferSelect
export type NewActionLog = typeof actionLogs.$inferInsert
