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
    @Res() res: Response,
  ) {
    const fileId = Number(fileIdStr)
    if (!Number.isInteger(fileId)) throw new BadRequestException()

    const path = await this.filesService.resolveFile(fileId, remoteFileId)
    if (!path || !fs.existsSync(path)) throw new NotFoundException('file not ready')

    // Cache aggressively — Telegram file content is immutable per file_id
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable')
    return res.sendFile(path)
  }
}
