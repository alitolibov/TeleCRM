import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'

@Injectable()
export class SettingsService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  /** Returns the single settings row, creating it with defaults on first access. */
  async get(): Promise<schema.AppSettings> {
    const [row] = await this.db.select().from(schema.appSettings).limit(1)
    if (row) return row
    const [created] = await this.db.insert(schema.appSettings).values({}).returning()
    return created
  }

  async update(patch: { escalationNewMinutes?: number; escalationReplyMinutes?: number }) {
    const current = await this.get()
    const [updated] = await this.db
      .update(schema.appSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.appSettings.id, current.id))
      .returning()
    return updated
  }
}
