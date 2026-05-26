import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { LogsService } from './logs.service'
import { ListLogsDto } from './dto/list-logs.dto'

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  list(@Query() query: ListLogsDto) {
    return this.logs.list(query)
  }
}
