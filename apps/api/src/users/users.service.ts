import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE, type Db } from '../db/drizzle.module'
import { users } from '../db/schema'

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private db: Db) {}

  findById(id: string) {
    return this.db.query.users.findFirst({ where: eq(users.id, id) })
  }

  findByUsername(username: string) {
    return this.db.query.users.findFirst({ where: eq(users.username, username) })
  }
}
