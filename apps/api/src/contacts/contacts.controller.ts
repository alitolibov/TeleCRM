import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { ContactsService } from './contacts.service'
import { UpsertContactDto } from './dto/contact.dto'

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Get()
  list() {
    return this.service.list()
  }

  @Post()
  upsert(@CurrentUser() user: { id: string }, @Body() dto: UpsertContactDto) {
    return this.service.upsert(user.id, dto)
  }

  /** Status probe for the sidebar button. "Not a contact" is a normal state
   *  for fresh chats, so we answer with `null` + 200 instead of 404 — keeps
   *  the browser dev tools clean from spurious red rows on every chat open. */
  @Get('by-client/:clientId')
  async findByClient(@Param('clientId') clientId: string) {
    return (await this.service.findByClient(clientId)) ?? null
  }
}
