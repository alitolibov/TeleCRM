import { Controller, Get } from '@nestjs/common'
import { APP_NAME } from '@telecrm/shared'

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', app: APP_NAME }
  }
}
