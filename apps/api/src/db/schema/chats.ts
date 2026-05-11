import { pgTable, uuid, timestamp, integer, index } from 'drizzle-orm/pg-core'
import { chatStatus } from './enums'
import { clients } from './clients'
import { users } from './users'

export const chats = pgTable('chats', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  assignedTo: uuid('assigned_to').references(() => users.id),
  status: chatStatus('status').notNull().default('new'),
  unreadCount: integer('unread_count').notNull().default(0),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('chats_client_id_idx').on(t.clientId),
  index('chats_assigned_to_idx').on(t.assignedTo),
  index('chats_assigned_status_idx').on(t.assignedTo, t.status),
  index('chats_last_message_at_idx').on(t.lastMessageAt),
])

export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert
