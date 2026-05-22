/**
 * Mark drizzle's __drizzle_migrations table to "already applied" for the
 * current (squashed) migration. Run this AFTER deleting old migration files
 * and re-generating a single consolidated migration via `pnpm db:generate`.
 *
 * Usage: `pnpm tsx apps/api/scripts/squash-migrations.ts`
 *        (or via docker exec on the server)
 */
import { createHash } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { Pool } from 'pg'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const migrationsDir = resolve(__dirname, '../migrations')
  const sqlFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  if (sqlFiles.length !== 1) {
    throw new Error(`Expected exactly 1 migration file after squash, found ${sqlFiles.length}: ${sqlFiles.join(', ')}`)
  }

  const sqlPath = resolve(migrationsDir, sqlFiles[0]!)
  const sqlContent = readFileSync(sqlPath, 'utf8')
  const hash = createHash('sha256').update(sqlContent).digest('hex')

  const journalPath = resolve(migrationsDir, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { when: number; tag: string }[] }
  const entry = journal.entries[0]
  if (!entry) throw new Error('Journal has no entries')

  const pool = new Pool({ connectionString: url })
  await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `)
  const before = await pool.query<{ count: string }>('SELECT count(*) FROM drizzle.__drizzle_migrations')
  await pool.query('TRUNCATE drizzle.__drizzle_migrations')
  await pool.query(
    'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
    [hash, entry.when],
  )
  console.log(`[squash] cleared ${before.rows[0]?.count ?? 0} old migration records`)
  console.log(`[squash] marked ${entry.tag} as applied (hash=${hash.slice(0, 16)}…)`)
  await pool.end()
}

main().catch((err) => {
  console.error('[squash] failed:', err)
  process.exit(1)
})
