import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { resolve } from 'path'

async function run() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool)

  const folder = process.env.MIGRATIONS_DIR ?? resolve(__dirname, '../../migrations')
  console.log(`[migrate] running from ${folder}`)
  await migrate(db, { migrationsFolder: folder })

  console.log('[migrate] done')
  await pool.end()
}

run().catch((err) => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
