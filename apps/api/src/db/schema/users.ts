import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'
import { userRole, userStatus } from './enums'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 50 }).unique().notNull(),
  passwordHash: varchar('password_hash').notNull(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }),
  role: userRole('role').notNull(),
  status: userStatus('status').notNull().default('offline'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  /** Round-robin cursor: when this user last received an auto-distributed chat.
   *  pickAssignee orders eligible (online + idle) users by this column ASC NULLS
   *  FIRST so the rotation is fair regardless of total workload. */
  lastAutoAssignedAt: timestamp('last_auto_assigned_at', { withTimezone: true }),
  // Soft delete — preserves history (chats.assigned_to, action_logs.actor_id, ...).
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
