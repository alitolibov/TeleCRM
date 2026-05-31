import { pgTable, uuid, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Per-user private scratch space (Telegram's "Saved Messages" equivalent).
 *
 * Entries never reach Telegram and are visible only to the user who created
 * them. `content` mirrors the shape of `messages.content` so the existing
 * MessageBubble component renders them verbatim; `source` is a snapshot of
 * the original chat/message when an entry was created via the "forward"
 * action (null for plain notes). Snapshotting (vs FK) means the forward
 * survives even if the original chat/message is deleted.
 */
export const favorites = pgTable('favorites', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: jsonb('content').notNull(),
  source: jsonb('source'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Listing is always "my favorites, newest first".
  index('favorites_user_created_idx').on(t.userId, t.createdAt),
])

export type Favorite = typeof favorites.$inferSelect
export type NewFavorite = typeof favorites.$inferInsert
