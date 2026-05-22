import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common'
import * as argon2 from 'argon2'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { DRIZZLE, type Db } from '../db/drizzle.module'
import * as schema from '../db/schema'
import { UsersGateway } from './users.gateway'
import { ChatsService } from '../chats/chats.service'
import type { CreateUserDto } from './dto/create-user.dto'
import type { UpdateUserDto } from './dto/update-user.dto'

/** A user closer to closing their tab than this is auto-flipped to offline. */
const STALE_THRESHOLD_MS = 5 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000

@Injectable()
export class UsersService implements OnModuleInit, OnModuleDestroy {
  private sweepTimer: NodeJS.Timeout | null = null

  constructor(
    @Inject(DRIZZLE) private db: Db,
    @Optional() @Inject(forwardRef(() => UsersGateway)) private gateway?: UsersGateway,
    @Optional() @Inject(forwardRef(() => ChatsService)) private chatsService?: ChatsService,
  ) {}

  onModuleInit() {
    // Periodic sweeper — flips users who haven't pinged in 5 min to offline.
    this.sweepTimer = setInterval(() => {
      this.sweepStaleUsers().catch((e) => console.error('[users] sweep failed:', e))
    }, SWEEP_INTERVAL_MS)
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
  }

  findById(id: string) {
    return this.db.query.users.findFirst({ where: eq(schema.users.id, id) })
  }

  findByUsername(username: string) {
    return this.db.query.users.findFirst({
      where: and(eq(schema.users.username, username), isNull(schema.users.deletedAt)),
    })
  }

  /** Same as findById but strips the password hash — safe for /me responses. */
  async publicFindById(id: string) {
    const u = await this.findById(id)
    if (!u) return null
    const { passwordHash: _ph, ...rest } = u
    return rest
  }

  /** Full directory — used by admin lists, transfer modal, auto-distribution. */
  findAllPublic() {
    return this.db.query.users.findMany({
      where: isNull(schema.users.deletedAt),
      columns: { passwordHash: false },
      orderBy: (u, { asc }) => asc(u.firstName),
    })
  }

  /**
   * For the /employees admin view: list + active-chat counts in a single query.
   * "active" = chat.status in ('new','active') AND assigned_to = user.id.
   */
  async findAllWithStats() {
    const rows = await this.db.execute<{
      id: string; username: string; first_name: string; last_name: string | null;
      role: 'admin' | 'manager'; status: 'online' | 'offline';
      last_seen_at: Date | null; created_at: Date; updated_at: Date;
      active_chats: string;
    }>(sql`
      SELECT
        u.id, u.username, u.first_name, u.last_name, u.role, u.status,
        u.last_seen_at, u.created_at, u.updated_at,
        COALESCE(c.cnt, 0)::text AS active_chats
      FROM ${schema.users} u
      LEFT JOIN (
        SELECT assigned_to, COUNT(*)::int AS cnt
        FROM ${schema.chats}
        WHERE status IN ('new', 'active') AND assigned_to IS NOT NULL
        GROUP BY assigned_to
      ) c ON c.assigned_to = u.id
      WHERE u.deleted_at IS NULL
      ORDER BY u.first_name ASC
    `)

    return rows.rows.map((r) => ({
      id: r.id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      role: r.role,
      status: r.status,
      // db.execute returns timestamps as strings (no drizzle column mapping for raw SQL),
      // so normalize via Date() which accepts both string and Date inputs.
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      activeChats: Number(r.active_chats),
    }))
  }

  // === CRUD (admin only — guarded at controller level) ===

  async createUser(dto: CreateUserDto, actorId: string) {
    const existing = await this.db.query.users.findFirst({
      where: eq(schema.users.username, dto.username),
    })
    if (existing) throw new ConflictException('username уже занят')

    const passwordHash = await argon2.hash(dto.password)
    const [user] = await this.db.insert(schema.users).values({
      username: dto.username,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName ?? null,
      role: dto.role,
      status: 'offline',
    }).returning({ id: schema.users.id })

    await this.db.insert(schema.actionLogs).values({
      action: 'user_created',
      actorId,
      metadata: { createdUserId: user.id, username: dto.username, role: dto.role },
    })

    return this.publicFindById(user.id)
  }

  async updateUser(id: string, dto: UpdateUserDto, _actorId: string) {
    const target = await this.findById(id)
    if (!target || target.deletedAt) throw new NotFoundException('user not found')

    // Last admin protection — same idea as in deleteUser, but for the demote path:
    // changing role from 'admin' to 'manager' could lock everyone out if this is
    // the only admin left.
    if (dto.role === 'manager' && target.role === 'admin') {
      const remainingAdmins = await this.db.query.users.findMany({
        where: and(eq(schema.users.role, 'admin'), isNull(schema.users.deletedAt)),
        columns: { id: true },
      })
      if (remainingAdmins.length <= 1) {
        throw new ForbiddenException('нельзя понизить единственного администратора до менеджера')
      }
    }

    const updates: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() }
    if (dto.firstName !== undefined) updates.firstName = dto.firstName
    if (dto.lastName !== undefined) updates.lastName = dto.lastName
    if (dto.role !== undefined) updates.role = dto.role
    if (dto.password !== undefined) updates.passwordHash = await argon2.hash(dto.password)

    await this.db.update(schema.users).set(updates).where(eq(schema.users.id, id))
    return this.publicFindById(id)
  }

  async deleteUser(id: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('нельзя удалить самого себя')
    }
    const target = await this.findById(id)
    if (!target || target.deletedAt) throw new NotFoundException('user not found')

    // Last admin protection — prevent locking yourself out.
    if (target.role === 'admin') {
      const remaining = await this.db.query.users.findMany({
        where: and(eq(schema.users.role, 'admin'), isNull(schema.users.deletedAt)),
        columns: { id: true },
      })
      if (remaining.length <= 1) {
        throw new ForbiddenException('нельзя удалить единственного администратора')
      }
    }

    // Release the user's open chats back to the queue BEFORE soft-deleting,
    // so they don't end up "owned by a ghost". Closed chats stay assigned for
    // historical record (the admin tag will still show their name).
    const releasedCount = (await this.chatsService?.releaseChatsAssignedTo(id)) ?? 0

    await this.db.update(schema.users)
      .set({ deletedAt: new Date(), status: 'offline', updatedAt: new Date() })
      .where(eq(schema.users.id, id))

    // Revoke all live sessions so refresh tokens stop working immediately.
    await this.db.update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(schema.sessions.userId, id),
        isNull(schema.sessions.revokedAt),
      ))

    // Kick all open WS connections (any browser tab they had open).
    this.gateway?.disconnectUser(id)

    await this.db.insert(schema.actionLogs).values({
      action: 'user_deleted',
      actorId,
      metadata: { deletedUserId: id, username: target.username, releasedChats: releasedCount },
    })

    // Try to immediately reassign the released chats to whoever's still online.
    if (releasedCount > 0) {
      this.chatsService?.distributeQueuedChats().catch((e) =>
        console.error('[users] distribute after delete failed:', e),
      )
    }

    return { id, deleted: true, releasedChats: releasedCount }
  }

  /** Heartbeat — bumps lastSeenAt without touching status. */
  async heartbeat(userId: string) {
    await this.db
      .update(schema.users)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.users.id, userId))
  }

  /** Manual status flip (the toggle in the sidebar). */
  async setStatus(userId: string, status: 'online' | 'offline') {
    const before = await this.findById(userId)
    if (!before) return null
    if (before.status === status) {
      return { id: before.id, status: before.status, lastSeenAt: before.lastSeenAt?.toISOString() ?? null }
    }

    const now = new Date()
    const [updated] = await this.db
      .update(schema.users)
      .set({ status, lastSeenAt: now, updatedAt: now })
      .where(eq(schema.users.id, userId))
      .returning({ id: schema.users.id, status: schema.users.status, lastSeenAt: schema.users.lastSeenAt })

    await this.db.insert(schema.actionLogs).values({
      action: 'user_status_changed',
      actorId: userId,
      metadata: { from: before.status, to: status },
    })

    const payload = {
      id: updated.id,
      status: updated.status,
      lastSeenAt: updated.lastSeenAt?.toISOString() ?? null,
    }
    this.gateway?.emitUserStatus(payload)

    // Coming online → drain the unassigned `new`-chat queue. Spec: "Как только
    // сотрудник выходит Online — система предлагает ему взять чат из очереди".
    // We auto-distribute here instead of just notifying — simpler UX, matches
    // the auto-distribution policy used for fresh incoming messages.
    if (status === 'online' && before.status !== 'online') {
      this.chatsService?.distributeQueuedChats().catch((e) =>
        console.error('[users] distributeQueuedChats failed:', e),
      )
    }

    return payload
  }

  /**
   * Background sweep: anyone with lastSeenAt older than the stale threshold
   * AND currently online → flip to offline. Matches the spec: "при закрытии
   * браузера статус автоматически переходит в Offline через 5 минут".
   */
  private async sweepStaleUsers() {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS)
    const stale = await this.db
      .update(schema.users)
      .set({ status: 'offline', updatedAt: new Date() })
      .where(and(
        eq(schema.users.status, 'online'),
        sql`(${schema.users.lastSeenAt} IS NULL OR ${schema.users.lastSeenAt} < ${cutoff})`,
      ))
      .returning({ id: schema.users.id })

    for (const u of stale) {
      await this.db.insert(schema.actionLogs).values({
        action: 'user_status_changed',
        actorId: u.id,
        metadata: { from: 'online', to: 'offline', reason: 'stale_heartbeat' },
      })
      this.gateway?.emitUserStatus({ id: u.id, status: 'offline', lastSeenAt: null })
    }
  }
}
