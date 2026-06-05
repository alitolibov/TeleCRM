import { pgTable, uuid, varchar, timestamp, bigint, boolean } from 'drizzle-orm/pg-core'

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  telegramId: bigint('telegram_id', { mode: 'number' }).unique().notNull(),
  username: varchar('username', { length: 100 }),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }),
  phone: varchar('phone', { length: 20 }),
  /** Whether the CRM-account's Telegram has this user in its address book.
   *  Updated from TDLib's `user.is_contact` on every incoming message and on
   *  the open-time refresh. Drives the sidebar's "В контактах" button —
   *  CRM-side `contacts` row only controls the custom name override. */
  inTelegramContacts: boolean('in_telegram_contacts').notNull().default(false),
  /** TDLib UserStatus bucket — null until we ever see one. Valid values:
   *  'online' | 'offline' | 'recently' | 'last_week' | 'last_month' | 'long_ago' | 'empty'.
   *  Drives the chat header's "в сети / был(а) …" subline. */
  onlineStatus: varchar('online_status', { length: 16 }),
  /** Exact last-seen time (only meaningful when `online_status = 'offline'`,
   *  comes from TDLib's `userStatusOffline.was_online`). Null for any bucket
   *  status — those don't expose a precise timestamp. */
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert
