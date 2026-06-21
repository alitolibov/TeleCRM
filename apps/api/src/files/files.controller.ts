import { Controller, Get, Param, Query, Res, BadRequestException, NotFoundException } from '@nestjs/common'
import { Response } from 'express'
import * as fs from 'fs'
import { FilesService } from './files.service'

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // Public — file IDs are 64-bit TDLib internals, not enumerable from outside.
  // Auth via URL token would break <img>/<audio> src loading without extra wiring.
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

    // Cache aggressively — Telegram file content is immutable per file_id
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable')

    // Explicit Content-Type — TDLib stores files with extensions Express may not
    // map (e.g. .oga for voice), causing audio/video elements to refuse playback.
    const mime = mimeForContentType(contentType)
    const options = mime ? { headers: { 'Content-Type': mime } } : {}
    return res.sendFile(path, options)
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
