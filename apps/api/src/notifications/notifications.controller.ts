import { Controller, Get, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { NotificationsService } from './notifications.service'
import { PushSubscribeDto } from './dto/push-subscribe.dto'

@UseGuards(JwtAuthGuard)
@Controller('push')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('vapid-public-key')
  publicKey() {
    return { publicKey: this.notifications.getPublicKey() }
  }

  @Post('subscribe')
  subscribe(@CurrentUser() user: { id: string }, @Body() body: PushSubscribeDto) {
    return this.notifications.subscribe(user.id, body)
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(@CurrentUser() user: { id: string }, @Body('endpoint') endpoint: string) {
    return this.notifications.unsubscribe(user.id, endpoint)
  }
}
