import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as argon2 from 'argon2'
import * as schema from './schema'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://telecrm:telecrm@localhost:5432/telecrm',
})
const db = drizzle(pool, { schema })

const USERNAME = process.env.SEED_USERNAME ?? 'admin'
const PASSWORD = process.env.SEED_PASSWORD ?? 'admin123'
const FIRST_NAME = process.env.SEED_FIRST_NAME ?? 'Admin'

async function seed() {
  const existing = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.username, USERNAME),
  })

  if (existing) {
    console.log(`[seed] user "${USERNAME}" already exists, skipping`)
    return
  }

  const passwordHash = await argon2.hash(PASSWORD)
  const [user] = await db.insert(schema.users).values({
    username: USERNAME,
    passwordHash,
    firstName: FIRST_NAME,
    role: 'admin',
    status: 'offline',
  }).returning({ id: schema.users.id, username: schema.users.username })

  console.log(`[seed] created admin: ${user.username} (${user.id})`)
  console.log(`[seed] login: ${USERNAME} / ${PASSWORD}`)
  console.log(`[seed] change the password after first login!`)
}

seed()
  .catch(console.error)
  .finally(() => pool.end())
