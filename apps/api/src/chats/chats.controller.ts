import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { ChatsService } from './chats.service'
import { SendMessageDto } from './dto/send-message.dto'

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get()
  findAll(@CurrentUser() user: { id: string; role: string }) {
    return this.chatsService.findAll(user.id, user.role)
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

  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.chatsService.close(id)
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
    @CurrentUser() user: { id: string },
  ) {
    return this.chatsService.sendMessage(id, dto.text, user.id)
  }
}
