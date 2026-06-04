import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
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

  /** Status check for the sidebar button — returns the contact row or 404. */
  @Get('by-client/:clientId')
  async findByClient(@Param('clientId') clientId: string) {
    const row = await this.service.findByClient(clientId)
    if (!row) throw new NotFoundException('not a contact')
    return row
  }
}
