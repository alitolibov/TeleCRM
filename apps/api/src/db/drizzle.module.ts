import { Global, Module } from '@nestjs/common'
import { db } from './client'
import type { Db } from './client'

export const DRIZZLE = Symbol('DRIZZLE')

@Global()
@Module({
  providers: [{ provide: DRIZZLE, useValue: db }],
  exports: [DRIZZLE],
})
export class DrizzleModule {}

export type { Db }
