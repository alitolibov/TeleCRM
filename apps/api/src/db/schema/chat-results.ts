import { pgTable, uuid, varchar, timestamp, text, decimal } from 'drizzle-orm/pg-core'
import { chats } from './chats'
import { users } from './users'

export const chatResults = pgTable('chat_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: uuid('chat_id').unique().notNull().references(() => chats.id, { onDelete: 'cascade' }),
  // Machine key of the chosen close_reasons.value (managed by admin in settings).
  clientStatus: varchar('client_status', { length: 50 }).notNull(),
  flight: varchar('flight', { length: 200 }),
  dates: varchar('dates', { length: 200 }),
  amount: decimal('amount', { precision: 12, scale: 2 }),
  comment: text('comment'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type ChatResult = typeof chatResults.$inferSelect
export type NewChatResult = typeof chatResults.$inferInsert
