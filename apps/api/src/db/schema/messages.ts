import { pgTable, uuid, timestamp, boolean, bigint, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { senderType, contentType, messageStatus } from './enums'
import type { TgMessageContent } from '@telecrm/shared'
import { chats } from './chats'
import { users } from './users'

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: uuid('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  telegramMessageId: bigint('telegram_message_id', { mode: 'number' }).notNull(),
  senderType: senderType('sender_type').notNull(),
  senderId: uuid('sender_id').references(() => users.id),
  contentType: contentType('content_type').notNull(),
  content: jsonb('content').$type<TgMessageContent>().notNull(),
  isRead: boolean('is_read').notNull().default(false),
  isDeleted: boolean('is_deleted').notNull().default(false),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  // For replies — TG message id of the message being replied to (within same chat).
  // Stored as bigint (not uuid) so we don't need a self-FK on TDLib history we may not have.
  replyToTgId: bigint('reply_to_tg_id', { mode: 'number' }),
  status: messageStatus('status').notNull().default('sent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('messages_chat_created_idx').on(t.chatId, t.createdAt),
  uniqueIndex('messages_chat_tg_id_idx').on(t.chatId, t.telegramMessageId),
])

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
