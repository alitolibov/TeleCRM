import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import type { CreateQuickReplyDto, UpdateQuickReplyDto } from './dto/quick-reply.dto'

/**
 * Personal message templates (spec 19) — each is private to its owner.
 * Every method is scoped by userId so one manager can't touch another's.
 */
@Injectable()
export class QuickRepliesService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  list(userId: string) {
    return this.db.query.quickReplies.findMany({
      where: (q, { eq }) => eq(q.userId, userId),
      orderBy: (q, { asc }) => asc(q.name),
    })
  }

  async create(userId: string, dto: CreateQuickReplyDto) {
    const [row] = await this.db
      .insert(schema.quickReplies)
      .values({ userId, name: dto.name, body: dto.body })
      .returning()
    return row
  }

  async update(userId: string, id: string, dto: UpdateQuickReplyDto) {
    const [row] = await this.db
      .update(schema.quickReplies)
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.quickReplies.id, id), eq(schema.quickReplies.userId, userId)))
      .returning()
    if (!row) throw new NotFoundException('Шаблон не найден')
    return row
  }

  async remove(userId: string, id: string) {
    await this.db
      .delete(schema.quickReplies)
      .where(and(eq(schema.quickReplies.id, id), eq(schema.quickReplies.userId, userId)))
  }
}
