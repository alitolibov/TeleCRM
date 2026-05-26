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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.chatsService.findOne(id)
  }

  @Get(':id/messages')
  getMessages(@Param('id') id: string, @Query('before') before?: string) {
    return this.chatsService.getMessages(id, before)
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
