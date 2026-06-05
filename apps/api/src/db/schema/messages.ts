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
  /** When the OTHER side read this outgoing message — set from TDLib's
   *  `updateChatReadOutbox`. Null = not yet read. Used by MessageBubble to
   *  flip ✓ → ✓✓ on every outgoing content type. We don't reuse `isRead`
   *  for this because that field tracks incoming consumption (managed by
   *  `updateChatReadInbox`) — overloading would muddle both flows. */
  readAt: timestamp('read_at', { withTimezone: true }),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  // For replies — TG message id of the message being replied to (within same chat).
  // Stored as bigint (not uuid) so we don't need a self-FK on TDLib history we may not have.
  replyToTgId: bigint('reply_to_tg_id', { mode: 'number' }),
  /** Set when this message arrived via TG forward — drives the "Переслано от …"
   *  banner above the bubble. `name` is the original sender's display name
   *  (already resolved by the worker), `date` is the original send time. */
  forwardedFrom: jsonb('forwarded_from').$type<{ name: string; date: number }>(),
  status: messageStatus('status').notNull().default('sent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('messages_chat_created_idx').on(t.chatId, t.createdAt),
  uniqueIndex('messages_chat_tg_id_idx').on(t.chatId, t.telegramMessageId),
])

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
