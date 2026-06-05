import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { CloseReasonsService } from './close-reasons.service'
import {
  CreateCloseReasonDto,
  ReorderCloseReasonsDto,
  UpdateCloseReasonDto,
} from './dto/close-reason.dto'

@UseGuards(JwtAuthGuard)
@Controller('close-reasons')
export class CloseReasonsController {
  constructor(private readonly service: CloseReasonsService) {}

  /** Authenticated users (managers + admins) need to read the list to populate
   *  the close-chat dialog. Mutations below are admin-only. */
  @Get()
  list() {
    return this.service.list()
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateCloseReasonDto) {
    return this.service.create(user.id, dto)
  }

  @Patch('reorder')
  @UseGuards(RolesGuard)
  @Roles('admin')
  reorder(@Body() dto: ReorderCloseReasonsDto) {
    return this.service.reorder(dto.ids)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateCloseReasonDto) {
    return this.service.update(id, dto)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.service.remove(id)
  }
}
