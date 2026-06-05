import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import type { CreateCloseReasonDto, UpdateCloseReasonDto } from './dto/close-reason.dto'

@Injectable()
export class CloseReasonsService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  list() {
    return this.db.query.closeReasons.findMany({
      orderBy: (r, { asc }) => [asc(r.sortOrder), asc(r.label)],
    })
  }

  async create(userId: string, dto: CreateCloseReasonDto) {
    const exists = await this.db.query.closeReasons.findFirst({
      where: (r, { eq }) => eq(r.value, dto.value),
      columns: { id: true },
    })
    if (exists) throw new ConflictException('Статус с таким идентификатором уже существует')

    const [row] = await this.db
      .insert(schema.closeReasons)
      .values({
        value: dto.value,
        label: dto.label,
        sortOrder: dto.sortOrder ?? 0,
        createdBy: userId,
      })
      .returning()
    return row
  }

  async update(id: string, dto: UpdateCloseReasonDto) {
    const patch: Partial<typeof schema.closeReasons.$inferInsert> = { updatedAt: new Date() }
    if (dto.label !== undefined) patch.label = dto.label
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder

    const [row] = await this.db
      .update(schema.closeReasons)
      .set(patch)
      .where(eq(schema.closeReasons.id, id))
      .returning()
    if (!row) throw new NotFoundException('Статус не найден')
    return row
  }

  async remove(id: string) {
    const reason = await this.db.query.closeReasons.findFirst({
      where: (r, { eq }) => eq(r.id, id),
      columns: { id: true, value: true },
    })
    if (!reason) throw new NotFoundException('Статус не найден')

    // Block delete if any closed chat already uses this status — historical
    // records would otherwise show empty labels in the Results view.
    const inUse = await this.db.query.chatResults.findFirst({
      where: (r, { eq }) => eq(r.clientStatus, reason.value),
      columns: { id: true },
    })
    if (inUse) {
      throw new BadRequestException(
        'Статус уже используется в закрытых чатах и не может быть удалён',
      )
    }

    await this.db.delete(schema.closeReasons).where(eq(schema.closeReasons.id, id))
  }

  /** Persists the order of ids one-to-one (10, 20, 30...). */
  async reorder(ids: string[]) {
    const rows = await this.db.query.closeReasons.findMany({
      where: (r, { inArray: ia }) => ia(r.id, ids),
      columns: { id: true },
    })
    if (rows.length !== ids.length) {
      throw new BadRequestException('Не все статусы найдены')
    }
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(schema.closeReasons)
          .set({ sortOrder: (i + 1) * 10, updatedAt: new Date() })
          .where(eq(schema.closeReasons.id, ids[i]))
      }
    })
    return this.list()
  }

  /** True if `value` matches any existing close-reason row. */
  async exists(value: string): Promise<boolean> {
    const row = await this.db.query.closeReasons.findFirst({
      where: (r, { eq }) => eq(r.value, value),
      columns: { id: true },
    })
    return !!row
  }
}
