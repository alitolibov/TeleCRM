import { pgTable, uuid, timestamp, text, index } from 'drizzle-orm/pg-core'
import { chats } from './chats'
import { users } from './users'

export const chatTransfers = pgTable('chat_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: uuid('chat_id').notNull().references(() => chats.id),
  fromUserId: uuid('from_user_id').references(() => users.id),
  toUserId: uuid('to_user_id').references(() => users.id),
  comment: text('comment').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('chat_transfers_chat_id_idx').on(t.chatId),
  index('chat_transfers_created_at_idx').on(t.createdAt),
])

export type ChatTransfer = typeof chatTransfers.$inferSelect
export type NewChatTransfer = typeof chatTransfers.$inferInsert
