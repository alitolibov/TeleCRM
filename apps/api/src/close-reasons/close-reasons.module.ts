import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { CloseReasonsService } from './close-reasons.service'
import { CloseReasonsController } from './close-reasons.controller'

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow('JWT_ACCESS_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CloseReasonsController],
  providers: [CloseReasonsService],
  exports: [CloseReasonsService],
})
export class CloseReasonsModule {}
