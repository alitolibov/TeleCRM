import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, lt } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { promises as fsp } from 'fs'
import { extname, join } from 'path'
import { randomUUID } from 'crypto'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import type { CreateFavoriteDto } from './dto/favorite.dto'
import { FAVORITES_DIR } from './storage'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

type MediaKind = 'photo' | 'video' | 'document'

/**
 * Personal "Saved Messages" — every method is hard-scoped by userId so one
 * employee can never see another's notes. Nothing here touches Telegram.
 *
 * Files: each media favorite lives at `{FAVORITES_DIR}/{userId}/{favoriteId}{ext}`
 * — the row id IS the storage key, so delete is just "drop the row, unlink
 * the file". The mime/ext are snapshotted in `content` so we never need to
 * sniff disk to serve them.
 */
@Injectable()
export class FavoritesService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  /**
   * Newest-first page. `before` is the createdAt of the oldest currently-loaded
   * entry — pass it on scroll-up to fetch older. The empty list signals "no
   * more" so the client can stop paging.
   */
  async list(userId: string, before?: string, limitRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const conds = [eq(schema.favorites.userId, userId)]
    if (before) conds.push(lt(schema.favorites.createdAt, new Date(before)))

    return this.db
      .select()
      .from(schema.favorites)
      .where(and(...conds))
      .orderBy(desc(schema.favorites.createdAt))
      .limit(limit)
  }

  async create(userId: string, dto: CreateFavoriteDto) {
    // Mirror messages.content shape so MessageBubble renders it as-is. The
    // optional `replyToId` is the parent favorite's id — findReplyTarget on
    // the client resolves it to a quote block.
    const content: Record<string, unknown> = { type: 'text', text: dto.text }
    if (dto.replyToId) content.replyToId = dto.replyToId

    const [row] = await this.db
      .insert(schema.favorites)
      .values({ userId, content })
      .returning()
    return row
  }

  /**
   * Save uploaded files to disk and insert one favorite row per file. The
   * caller's caption is attached to the first row only (matches the chat
   * upload's "caption on the first photo" UX).
   */
  async uploadMedia(
    userId: string,
    files: Array<{ originalname: string; mimetype: string; size: number; buffer: Buffer }>,
    caption?: string,
    replyToId?: string,
  ) {
    const userDir = join(FAVORITES_DIR, userId)
    await fsp.mkdir(userDir, { recursive: true })

    const inserted: typeof schema.favorites.$inferSelect[] = []
    let pendingCaption = caption?.trim() || undefined

    for (const f of files) {
      const id = randomUUID()
      const ext = extname(f.originalname) || ''
      const diskPath = join(userDir, `${id}${ext}`)
      await fsp.writeFile(diskPath, f.buffer)

      const kind: MediaKind = f.mimetype.startsWith('image/')
        ? 'photo'
        : f.mimetype.startsWith('video/')
          ? 'video'
          : 'document'

      const content: Record<string, unknown> = {
        type: kind,
        fileName: f.originalname,
        size: f.size,
        mimeType: f.mimetype,
        ext,
      }
      if (pendingCaption) {
        content.caption = pendingCaption
        pendingCaption = undefined
      }
      // Only the first entry of a multi-file upload carries the reply — the
      // remaining files are siblings within the same "reply", not separate
      // replies, matching how Telegram attaches a reply to an album.
      if (replyToId && inserted.length === 0) content.replyToId = replyToId

      const [row] = await this.db
        .insert(schema.favorites)
        .values({ id, userId, content })
        .returning()
      inserted.push(row)
    }
    return inserted
  }

  async remove(userId: string, id: string) {
    // Look up first so we can unlink the file before dropping the row.
    const row = await this.db.query.favorites.findFirst({
      where: (f, { and, eq }) => and(eq(f.id, id), eq(f.userId, userId)),
    })
    if (!row) return
    await this.unlinkIfMedia(row)
    await this.db
      .delete(schema.favorites)
      .where(and(eq(schema.favorites.id, id), eq(schema.favorites.userId, userId)))
  }

  /** "Clear chat" — wipes every entry for this user. Drops the user's media
   *  folder entirely; cheap and avoids per-row unlinks. Irreversible. */
  async clear(userId: string) {
    await this.db.delete(schema.favorites).where(eq(schema.favorites.userId, userId))
    await fsp.rm(join(FAVORITES_DIR, userId), { recursive: true, force: true })
  }

  /**
   * Resolve a media favorite to (disk path, mime, original file name) for
   * the file-serve endpoint. Returns null when the row doesn't exist, is a
   * text note, or the file is missing on disk.
   */
  async resolveMedia(id: string): Promise<
    { path: string; mimeType: string; fileName: string; kind: MediaKind } | null
  > {
    const row = await this.db.query.favorites.findFirst({
      where: (f, { eq }) => eq(f.id, id),
    })
    if (!row) return null
    const content = row.content as Record<string, unknown> | null
    const type = content?.type as string | undefined
    if (type !== 'photo' && type !== 'video' && type !== 'document') return null
    const ext = (content?.ext as string) ?? ''
    const path = join(FAVORITES_DIR, row.userId, `${row.id}${ext}`)
    return {
      path,
      mimeType: (content?.mimeType as string) ?? 'application/octet-stream',
      fileName: (content?.fileName as string) ?? row.id,
      kind: type as MediaKind,
    }
  }

  private async unlinkIfMedia(row: typeof schema.favorites.$inferSelect) {
    const content = row.content as Record<string, unknown> | null
    const type = content?.type as string | undefined
    if (type !== 'photo' && type !== 'video' && type !== 'document') return
    const ext = (content?.ext as string) ?? ''
    const path = join(FAVORITES_DIR, row.userId, `${row.id}${ext}`)
    await fsp.unlink(path).catch(() => { /* best-effort; row drop is what matters */ })
  }
}
