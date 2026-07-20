import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { REDIS_QUEUES } from '@telecrm/shared'
import { FilesController } from './files.controller'
import { FilesService } from './files.service'

@Module({
  imports: [
    BullModule.registerQueue({ name: REDIS_QUEUES.tgFileRequest }),
    BullModule.registerQueue({ name: REDIS_QUEUES.tgRefreshMessage }),
  ],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
