import { pgTable, uuid, varchar, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { clients } from './clients'
import { users } from './users'

/**
 * A client that's been promoted to a "saved contact" by someone on the team.
 *
 * Visibility is global — every employee sees every contact. The override
 * names are also written through to `clients.firstName/lastName` so they
 * show up in the chat list, header, and search without any join. The row
 * here is what tells the upsert in processIncomingEvent to STOP pulling the
 * Telegram-side name on top of the human-chosen one.
 *
 * One contact per client (UNIQUE) — re-adding just edits the existing row.
 */
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  addedBy: uuid('added_by').notNull().references(() => users.id),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('contacts_client_id_uq').on(t.clientId),
  index('contacts_added_at_idx').on(t.addedAt),
])

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
