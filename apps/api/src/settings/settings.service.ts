import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import { ChatsService } from '../chats/chats.service'

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private chats: ChatsService,
  ) {}

  /** Returns the single settings row, creating it with defaults on first access. */
  async get(): Promise<schema.AppSettings> {
    const [row] = await this.db.select().from(schema.appSettings).limit(1)
    if (row) return row
    const [created] = await this.db.insert(schema.appSettings).values({}).returning()
    return created
  }

  async update(patch: {
    escalationNewMinutes?: number
    escalationReplyMinutes?: number
    escalationUnclosedMinutes?: number
    maxChatsPerUser?: number
  }) {
    const current = await this.get()
    const [updated] = await this.db
      .update(schema.appSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.appSettings.id, current.id))
      .returning()

    // Raising the per-user cap means previously-blocked chats can now fit
    // somewhere — drain immediately instead of waiting for the periodic sweep.
    if (
      patch.maxChatsPerUser !== undefined
      && patch.maxChatsPerUser > current.maxChatsPerUser
    ) {
      this.chats.distributeQueuedChats().catch((e) =>
        console.error('[settings] post-cap-raise distribute failed:', e?.message),
      )
    }

    return updated
  }
}
