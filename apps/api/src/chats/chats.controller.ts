import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { extname } from 'path'
import { randomUUID } from 'crypto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { ChatsService } from './chats.service'
import { SendMessageDto } from './dto/send-message.dto'
import { CloseChatDto } from './dto/close-chat.dto'
import { EditMessageDto } from './dto/edit-message.dto'
import { ListChatsDto } from './dto/list-chats.dto'
import { TransferChatDto } from './dto/transfer-chat.dto'
import { ResultsQueryDto } from './dto/results-query.dto'

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get()
  findAll(
    @CurrentUser() user: { id: string; role: string },
    @Query() query: ListChatsDto,
  ) {
    return this.chatsService.findAll(user.id, user.role, query)
  }

  // Must be declared before ':id' so "results" isn't captured as a chat id.
  @Get('results')
  results(
    @CurrentUser() user: { id: string; role: string },
    @Query() query: ResultsQueryDto,
  ) {
    return this.chatsService.searchResults(user.id, user.role, query)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.chatsService.findOne(id)
  }

  @Get(':id/messages')
  getMessages(@Param('id') id: string, @Query('before') before?: string) {
    return this.chatsService.getMessages(id, before)
  }

  /** Photo/video messages from every chat this client has ever had with us. */
  @Get(':id/media')
  getClientMedia(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.chatsService.getClientMedia(
      id,
      limit ? Number(limit) : 60,
      offset ? Number(offset) : 0,
    )
  }

  /** Document attachments from every chat this client has ever had with us. */
  @Get(':id/files')
  getClientFiles(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.chatsService.getClientFiles(
      id,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    )
  }

  /** N messages around a given message (for "jump-to-message" deep links). */
  @Get(':id/messages/around/:messageId')
  getMessagesAround(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatsService.getMessagesAround(id, messageId, limit ? Number(limit) : 30)
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.chatsService.assign(id, user.id)
  }

  @Patch(':id/transfer')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferChatDto,
    @CurrentUser() user: { id: string; role: 'admin' | 'manager' },
  ) {
    return this.chatsService.transfer(id, user.id, user.role, dto.toUserId ?? null, dto.comment)
  }

  @Patch(':id/close')
  close(
    @Param('id') id: string,
    @Body() dto: CloseChatDto,
    @CurrentUser() user: { id: string; role: 'admin' | 'manager' },
  ) {
    return this.chatsService.close(id, user.id, user.role, dto)
  }

  @Get(':id/info')
  info(@Param('id') id: string) {
    return this.chatsService.getClientInfo(id)
  }

  @Patch(':id/reopen')
  reopen(@Param('id') id: string, @CurrentUser() user: { id: string; role: 'admin' | 'manager' }) {
    return this.chatsService.reopen(id, user.id, user.role)
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@Param('id') id: string) {
    return this.chatsService.markRead(id)
  }

  @Post(':id/messages')
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: { id: string; role: 'admin' | 'manager' },
  ) {
    return this.chatsService.sendMessage(id, dto.text, user.id, user.role, dto.replyTo)
  }

  @Patch(':id/messages/:messageId')
  editMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
    @CurrentUser() user: { id: string; role: 'admin' | 'manager' },
  ) {
    return this.chatsService.editMessage(id, messageId, dto.text, user.id, user.role)
  }

  @Delete(':id/messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string; role: 'admin' | 'manager' },
  ) {
    return this.chatsService.deleteMessage(id, messageId, user.id, user.role)
  }

  @Post(':id/messages/:messageId/pin')
  pinMessage(@Param('id') id: string, @Param('messageId') messageId: string) {
    return this.chatsService.pinMessage(id, messageId, true)
  }

  @Delete(':id/messages/:messageId/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  unpinMessage(@Param('id') id: string, @Param('messageId') messageId: string) {
    return this.chatsService.pinMessage(id, messageId, false)
  }

  @Post(':id/messages/:messageId/forward')
  forwardMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body('toChatId') toChatId: number,
  ) {
    if (typeof toChatId !== 'number') {
      throw new BadRequestException('toChatId must be a number')
    }
    return this.chatsService.forwardMessageToTg(id, messageId, toChatId)
  }

  /** Picker for "Переслать в TG-чат" — type-ahead, server-backed. */
  @Get('tg-chats/search')
  searchTgChats(@Query('q') q: string | undefined, @Query('limit') limit: string | undefined) {
    const lim = limit ? Math.min(Number(limit) || 20, 50) : 20
    return this.chatsService.searchTgChats(q ?? '', lim)
  }

  @Post(':id/sync-history')
  syncHistory(
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const beforeTgId = before ? Number(before) : 0
    const lim = limit ? Math.min(Number(limit), 100) : 50
    return this.chatsService.syncHistory(id, beforeTgId, lim)
  }

  @Post(':id/upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: '/tmp/telecrm-uploads',
        filename: (_req, file, cb) => {
          const safeName = `${Date.now()}-${randomUUID()}${extname(file.originalname)}`
          cb(null, safeName)
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
    }),
  )
  upload(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('caption') caption: string | undefined,
    @CurrentUser() user: { id: string; role: 'admin' | 'manager' },
  ) {
    if (!files?.length) throw new BadRequestException('No file uploaded')
    return this.chatsService.sendMedia(
      id,
      files.map((f) => ({
        filePath: f.path,
        fileName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
      })),
      user.id,
      user.role,
      caption,
    )
  }
}
