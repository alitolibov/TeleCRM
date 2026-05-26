import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull, ne } from 'drizzle-orm'
import * as argon2 from 'argon2'
import { DRIZZLE, type Db } from '../db/drizzle.module'
import { sessions, users, actionLogs } from '../db/schema'
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

  async login(user: User, meta: { userAgent?: string; ip?: string }, logEvent = true) {
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

    // Audit log (spec 13). `logEvent=false` on token refresh so it isn't spammed.
    if (logEvent) {
      await this.db.insert(actionLogs).values({
        action: 'user_login', actorId: user.id, metadata: { userAgent: meta.userAgent ?? null },
      }).catch(() => {})
    }

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

    return this.login(session.user, meta, false)
  }

  /** Active sessions for the user (spec 11) — current device flagged via the cookie. */
  async listSessions(userId: string, currentRefreshToken?: string) {
    const rows = await this.db.query.sessions.findMany({
      where: and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
      orderBy: (s, { desc }) => desc(s.createdAt),
    })
    const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : null
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      current: currentHash != null && s.refreshTokenHash === currentHash,
    }))
  }

  /** Revoke every active session except the current device (spec 11). */
  async revokeOtherSessions(userId: string, currentRefreshToken?: string) {
    const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : null
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        ...(currentHash ? [ne(sessions.refreshTokenHash, currentHash)] : []),
      ))
    return { ok: true }
  }

  /** Revoke one of the user's own sessions (ends that device's access on next refresh). */
  async revokeSession(userId: string, sessionId: string) {
    const [revoked] = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id })
    return { ok: !!revoked }
  }

  async logout(refreshToken: string) {
    const hash = hashToken(refreshToken)
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.refreshTokenHash, hash),
      columns: { userId: true },
    })
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.refreshTokenHash, hash))
    if (session) {
      await this.db.insert(actionLogs).values({ action: 'user_logout', actorId: session.userId }).catch(() => {})
    }
  }
}
