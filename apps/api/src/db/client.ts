import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://telecrm:telecrm@localhost:5432/telecrm',
})

export const db = drizzle(pool, { schema })
export type Db = typeof db
