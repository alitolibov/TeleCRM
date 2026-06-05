/**
 * Full data wipe — fresh start for the client while keeping employees and
 * configuration in place.
 *
 * WIPES (DB):
 *  - chats, messages, chat_results, chat_transfers (chat data)
 *  - clients (the TG party records)
 *  - contacts (saved CRM contacts)
 *  - action_logs (all logs, not just chat-scoped)
 *  - favorites (per-user saved messages)
 *
 * WIPES (filesystem):
 *  - favorites uploads directory (FAVORITES_DIR; defaults to /app/data/favorites)
 *
 * KEEPS:
 *  - users + sessions (employees stay logged in)
 *  - app_settings + close_reasons (admin configuration)
 *  - quick_replies (admin-authored templates)
 *  - push_subscriptions (browser push stays armed)
 *
 * Also resets users.last_auto_assigned_at so the round-robin starts from a
 * clean rotation — otherwise the first chat after the wipe goes to whoever
 * was last in the pre-wipe rotation, which is arbitrary noise.
 *
 * Does NOT touch tg-worker's TDLib session (data/tdlib/) — that lives in a
 * separate container/volume and getting it back would mean re-authorising
 * the bot number from scratch.
 *
 * Usage:  DATABASE_URL=postgresql://... tsx apps/api/scripts/reset-data.ts
 *         (FAVORITES_DIR=/custom/path  optional)
 */
import { Pool } from 'pg'
import { rm, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const favoritesDir = resolve(process.env.FAVORITES_DIR ?? '/app/data/favorites')

  const pool = new Pool({ connectionString: url })

  // One transaction so a failure leaves the DB exactly as we found it.
  // CASCADE on chats also takes out the FK-linked rows in case any survived
  // the explicit list (e.g. a future child table I'm not aware of yet).
  await pool.query(`
    BEGIN;
    TRUNCATE
      messages,
      chat_results,
      chat_transfers,
      chats,
      clients,
      contacts,
      action_logs,
      favorites
    RESTART IDENTITY CASCADE;

    -- Round-robin cursor: clear it so the next assignment starts fresh
    -- (NULLS FIRST in pickAssignee gives every user an equal first shot).
    UPDATE users SET last_auto_assigned_at = NULL WHERE last_auto_assigned_at IS NOT NULL;
    COMMIT;
  `)

  // Files for the deleted favorites — drop the per-user directories.
  // Recreate the parent so the worker keeps writing without re-checking it.
  try {
    await rm(favoritesDir, { recursive: true, force: true })
    await mkdir(favoritesDir, { recursive: true })
    console.log(`[reset-data] cleared ${favoritesDir}`)
  } catch (e) {
    console.warn(`[reset-data] could not clear ${favoritesDir}: ${(e as Error).message}`)
  }

  // Read back what survived so the operator sees the result of the wipe.
  const counts = await pool.query<{ table: string; cnt: string }>(`
                SELECT 'chats'              AS table, COUNT(*)::text AS cnt FROM chats
      UNION ALL SELECT 'messages',                    COUNT(*)::text         FROM messages
      UNION ALL SELECT 'clients',                     COUNT(*)::text         FROM clients
      UNION ALL SELECT 'contacts',                    COUNT(*)::text         FROM contacts
      UNION ALL SELECT 'action_logs',                 COUNT(*)::text         FROM action_logs
      UNION ALL SELECT 'favorites',                   COUNT(*)::text         FROM favorites
      UNION ALL SELECT 'users (kept)',                COUNT(*)::text         FROM users
      UNION ALL SELECT 'sessions (kept)',             COUNT(*)::text         FROM sessions
      UNION ALL SELECT 'quick_replies (kept)',        COUNT(*)::text         FROM quick_replies
      UNION ALL SELECT 'close_reasons (kept)',        COUNT(*)::text         FROM close_reasons
      UNION ALL SELECT 'push_subscriptions (kept)',   COUNT(*)::text         FROM push_subscriptions
  `)
  console.log('[reset-data] done — final counts:')
  for (const r of counts.rows) console.log(`  ${r.table.padEnd(28)} ${r.cnt}`)

  await pool.end()
}

main().catch((err) => {
  console.error('[reset-data] failed:', err)
  process.exit(1)
})
