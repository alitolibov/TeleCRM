import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import * as argon2 from 'argon2'
import { DRIZZLE, type Db } from '../db/drizzle.module'
import { sessions, users } from '../db/schema'
import { UsersService } from '../users/users.service'
import type { User } from '../db/schema'

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private db: Db,
    private usersService: UsersService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async validateUser(username: string, password: string) {
    const user = await this.usersService.findByUsername(username)
    if (!user) return null
    const valid = await argon2.verify(user.passwordHash, password)
    if (!valid) return null
    return user
  }

  async login(user: User, meta: { userAgent?: string; ip?: string }) {
    const accessToken = this.jwtService.sign(
      { sub: user.id, role: user.role },
      { secret: this.config.get('JWT_ACCESS_SECRET'), expiresIn: '8h' },
    )

    const refreshToken = randomUUID()
    await this.db.insert(sessions).values({
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    })

    return { accessToken, refreshToken, user }
  }

  async refresh(refreshToken: string, meta: { userAgent?: string; ip?: string }) {
    const hash = hashToken(refreshToken)

    const session = await this.db.query.sessions.findFirst({
      where: and(
        eq(sessions.refreshTokenHash, hash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
      with: { user: true },
    })

    if (!session) throw new UnauthorizedException('Invalid or expired refresh token')

    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, session.id))

    return this.login(session.user, meta)
  }

  async logout(refreshToken: string) {
    const hash = hashToken(refreshToken)
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.refreshTokenHash, hash))
  }
}
