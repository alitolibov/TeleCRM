import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { QuickRepliesService } from './quick-replies.service'
import { CreateQuickReplyDto, UpdateQuickReplyDto } from './dto/quick-reply.dto'

@UseGuards(JwtAuthGuard)
@Controller('quick-replies')
export class QuickRepliesController {
  constructor(private readonly service: QuickRepliesService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.service.list(user.id)
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateQuickReplyDto) {
    return this.service.create(user.id, dto)
  }

  @Patch(':id')
  update(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: UpdateQuickReplyDto) {
    return this.service.update(user.id, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.service.remove(user.id, id)
  }
}
