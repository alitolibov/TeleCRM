import { Controller, Get, Param, Query, Res, BadRequestException, NotFoundException, Inject } from '@nestjs/common'
import { Response } from 'express'
import * as fs from 'fs'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { FilesService } from './files.service'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'

@Controller('files')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Message-keyed URL: /files/m/<crm-message-uuid>. The URL never changes
   * for a given message, so browser cache updates are correct even when the
   * underlying TDLib fileId / remoteFileId change (heal script, re-auth,
   * mirror mirror population). This is the CANONICAL endpoint; the legacy
   * `/files/:fileId?r=&t=` stays for backwards compat but new frontend
   * links use this one exclusively.
   *
   * Public: the CRM message uuid isn't enumerable from outside.
   */
  @Get('m/:messageId')
  async getFileByMessage(
    @Param('messageId') messageId: string,
    @Res() res: Response,
  ) {
    const msg = await this.db.query.messages.findFirst({
      where: (m, { eq }) => eq(m.id, messageId),
      columns: { content: true, chatId: true, telegramMessageId: true },
    })
    if (!msg) throw new NotFoundException('message not found')
    let c = msg.content as any
    if (!c?.fileId) throw new NotFoundException('message has no file')

    let path = await this.filesService.resolveFile(
      Number(c.fileId),
      c.remoteFileId ?? undefined,
      c.type,
    )

    // A stale file_reference inside remoteFileId makes downloadFile fail while
    // everything upstream looks healthy. Re-fetch the message to get a fresh
    // reference, persist it, and retry once — otherwise the file stays dead
    // forever and only a manual heal run could recover it.
    if (!path || !fs.existsSync(path)) {
      const healed = await this.healContent(messageId, msg.chatId, msg.telegramMessageId)
      if (healed) {
        c = healed
        path = await this.filesService.resolveFile(
          Number(c.fileId),
          c.remoteFileId ?? undefined,
          c.type,
        )
      }
    }
    if (!path || !fs.existsSync(path)) throw new NotFoundException('file not ready')

    // Message-keyed URLs are safe to cache aggressively — the URL is a
    // stable pointer at the message and the message row can be updated
    // in place. If content shifts (rare — mostly the heal script), a
    // client-side reload still won't fetch, but the served path may be
    // a fresh mirror file. Trade-off accepted for CDN-friendliness.
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable')

    // Documents need the real MIME type from the message content (photo /
    // video / voice have baked-in defaults handled below). Without this a
    // PDF was going out as application/octet-stream and the browser
    // downloaded it instead of previewing.
    const docMime: string | null =
      c.type === 'document' && typeof c.mimeType === 'string' ? c.mimeType : null
    const mime = mimeForContentType(c.type) ?? docMime

    // Documents also need a filename so the browser saves them with the
    // original extension (otherwise the file drops onto disk as
    // `<uuid>` with no extension and refuses to open). PDFs specifically
    // get `inline` so the browser previews them in-tab instead of
    // downloading; everything else goes `attachment` with the filename.
    if (c.type === 'document' && typeof c.fileName === 'string' && c.fileName) {
      const safeName = c.fileName.replace(/["\\\r\n]/g, '_')
      const disposition = docMime === 'application/pdf' ? 'inline' : 'attachment'
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(c.fileName)}`)
    }

    const options = mime ? { headers: { 'Content-Type': mime } } : {}
    return res.sendFile(path, options)
  }

  // Legacy — kept for browser cache entries created before the /m/:id
  // switchover, plus any hard-coded external links.
  @Get(':fileId')
  async getFile(
    @Param('fileId') fileIdStr: string,
    @Query('r') remoteFileId: string | undefined,
    @Query('t') contentType: string | undefined,
    @Res() res: Response,
  ) {
    const fileId = Number(fileIdStr)
    if (!Number.isInteger(fileId)) throw new BadRequestException()

    const path = await this.filesService.resolveFile(fileId, remoteFileId, contentType as any)
    if (!path || !fs.existsSync(path)) throw new NotFoundException('file not ready')

    res.setHeader('Cache-Control', 'public, max-age=86400, immutable')

    const mime = mimeForContentType(contentType)
    const options = mime ? { headers: { 'Content-Type': mime } } : {}
    return res.sendFile(path, options)
  }

  /**
   * Asks TDLib for the message again and rewrites `content` with the fresh
   * remoteFileId. Returns the new content, or null when nothing usable came
   * back (message deleted in Telegram, chat gone, TDLib timeout).
   *
   * Only writes when the remoteFileId actually changed — a refresh that
   * returns the same value means the reference wasn't the problem, and
   * rewriting would just churn the row.
   */
  private async healContent(
    messageId: string,
    chatId: string,
    telegramMessageId: number | string | null,
  ): Promise<any | null> {
    if (!telegramMessageId) return null

    const chat = await this.db.query.chats.findFirst({
      where: (t, { eq }) => eq(t.id, chatId),
      columns: { clientId: true },
    })
    if (!chat) return null

    const client = await this.db.query.clients.findFirst({
      where: (t, { eq }) => eq(t.id, chat.clientId),
      columns: { telegramId: true },
    })
    if (!client?.telegramId) return null

    const fresh = await this.filesService.refreshContent(
      Number(client.telegramId),
      Number(telegramMessageId),
    )
    if (!fresh || !(fresh as any).remoteFileId) return null

    await this.db
      .update(schema.messages)
      .set({ content: fresh })
      .where(eq(schema.messages.id, messageId))

    return fresh
  }
}

function mimeForContentType(t: string | undefined): string | null {
  switch (t) {
    case 'photo':     return 'image/jpeg'
    case 'video':     return 'video/mp4'
    case 'videoNote': return 'video/mp4'
    // Telegram voice messages are always OGG Opus. Bare `audio/ogg` makes
    // modern Edge / Safari / strict Chrome refuse to decode (or play
    // silently) because OGG can also wrap Vorbis. The explicit codecs
    // hint resolves the ambiguity and gets sound back.
    case 'voice':     return 'audio/ogg; codecs=opus'
    case 'sticker':   return 'image/webp'
    default:          return null
  }
}
