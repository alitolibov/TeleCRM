/**
 * Wipes all chat-related data so you can test from scratch:
 *  - messages, chats, chat_results, chat_transfers (all chat data)
 *  - clients (the TG party records)
 *  - chat-scoped action_logs (other logs survive)
 *
 * KEEPS: users, sessions, push_subscriptions, quick_replies — you stay logged in.
 *
 * Usage:  DATABASE_URL=postgresql://... tsx apps/api/scripts/reset-chats.ts
 */
import { Pool } from 'pg'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const pool = new Pool({ connectionString: url })

  await pool.query(`
    BEGIN;
    -- chat_transfers / chat_results / messages cascade from chats via FK,
    -- but we TRUNCATE explicitly so sequences reset cleanly.
    TRUNCATE
      messages,
      chat_results,
      chat_transfers,
      chats,
      clients
    RESTART IDENTITY CASCADE;

    -- Drop only the action_logs that pointed at a deleted chat.
    DELETE FROM action_logs WHERE chat_id IS NOT NULL;
    COMMIT;
  `)

  const counts = await pool.query<{ table: string; cnt: string }>(`
    SELECT 'chats' AS table, COUNT(*)::text AS cnt FROM chats
    UNION ALL SELECT 'messages', COUNT(*)::text FROM messages
    UNION ALL SELECT 'clients',  COUNT(*)::text FROM clients
    UNION ALL SELECT 'users',    COUNT(*)::text FROM users
  `)
  console.log('[reset-chats] done — final counts:')
  for (const r of counts.rows) console.log(`  ${r.table.padEnd(10)} ${r.cnt}`)

  await pool.end()
}

main().catch((err) => {
  console.error('[reset-chats] failed:', err)
  process.exit(1)
})
