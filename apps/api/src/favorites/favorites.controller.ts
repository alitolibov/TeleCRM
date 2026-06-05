import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus,
  NotFoundException, Param, Post, Query, Res, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { Response } from 'express'
import * as fs from 'fs'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { FavoritesService } from './favorites.service'
import { CreateFavoriteDto, ListFavoritesDto } from './dto/favorite.dto'

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly service: FavoritesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: { id: string }, @Query() query: ListFavoritesDto) {
    return this.service.list(user.id, query.before, query.limit)
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateFavoriteDto) {
    return this.service.create(user.id, dto)
  }

  /** Forward a chat message into this user's favourites. The body's
   *  `messageId` is a CRM message uuid. */
  @UseGuards(JwtAuthGuard)
  @Post('forward')
  forward(@CurrentUser() user: { id: string }, @Body('messageId') messageId: string) {
    if (!messageId) throw new BadRequestException('messageId is required')
    return this.service.forwardMessage(user.id, messageId)
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      // In-memory buffers — the service writes them under the user's folder
      // so we don't need a temp-dir cleanup step.
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
    }),
  )
  upload(
    @CurrentUser() user: { id: string },
    @UploadedFiles() files: Express.Multer.File[],
    @Body('caption') caption: string | undefined,
    @Body('replyToId') replyToId: string | undefined,
  ) {
    if (!files?.length) throw new BadRequestException('No file uploaded')
    return this.service.uploadMedia(user.id, files, caption, replyToId)
  }

  @UseGuards(JwtAuthGuard)
  @Delete('clear')
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(@CurrentUser() user: { id: string }) {
    return this.service.clear(user.id)
  }

  /**
   * Public-by-unguessable-uuid (mirrors `/files/:fileId`). Img/video tags
   * can't send auth headers, and signing every URL adds churn; relying on
   * the v4 UUID's 122 bits of entropy is the same trade-off this codebase
   * already accepts for Telegram media. Each favorite row's id IS the
   * storage key — no enumeration vector beyond brute-force.
   */
  @Get('files/:id')
  async getFile(@Param('id') id: string, @Res() res: Response) {
    const media = await this.service.resolveMedia(id)
    if (!media) throw new NotFoundException('not found')
    if (!fs.existsSync(media.path)) throw new NotFoundException('file missing')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.setHeader('Content-Type', media.mimeType)
    if (media.kind === 'document') {
      // Documents download; images/videos render inline in the browser.
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(media.fileName)}"`,
      )
    }
    return res.sendFile(media.path)
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.service.remove(user.id, id)
  }
}
