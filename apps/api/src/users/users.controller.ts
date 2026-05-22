import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Patch, Post, UseGuards,
} from '@nestjs/common'
import { IsIn, IsString } from 'class-validator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'

export class SetStatusDto {
  @IsString()
  @IsIn(['online', 'offline'])
  status: 'online' | 'offline'
}

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Currently authenticated user (without passwordHash). */
  @Get('me')
  async me(@CurrentUser() user: { id: string }) {
    return this.users.publicFindById(user.id)
  }

  /** Manager/admin set their own online/offline status. */
  @Patch('me/status')
  setMyStatus(@Body() dto: SetStatusDto, @CurrentUser() user: { id: string }) {
    return this.users.setStatus(user.id, dto.status)
  }

  /** Plain user list — used by transfer modal, auto-distribution. */
  @Get()
  list() {
    return this.users.findAllPublic()
  }

  /** Rich list with active chat counts — admin /employees view. */
  @Get('with-stats')
  @UseGuards(RolesGuard)
  @Roles('admin')
  listWithStats() {
    return this.users.findAllWithStats()
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: { id: string }) {
    return this.users.createUser(dto, actor.id)
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: { id: string },
  ) {
    return this.users.updateUser(id, dto, actor.id)
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string, @CurrentUser() actor: { id: string }) {
    return this.users.deleteUser(id, actor.id)
  }
}
