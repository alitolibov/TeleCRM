import { Inject, Injectable, Optional, OnModuleInit, OnModuleDestroy, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common'
import { Queue, QueueEvents } from 'bullmq'
import { InjectQueue } from '@nestjs/bullmq'
import { ConfigService } from '@nestjs/config'
import { and, eq, or, isNull, ilike, desc, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type {
  TgMessageEvent,
  TgOutgoingJob,
  TgOutgoingContent,
  TgHistoryRequestJob,
  TgHistoryResponse,
  TgReadSyncEvent,
  TgEditJob,
  TgDeleteJob,
  TgMessageEditedEvent,
  TgMessageDeletedEvent,
  TgMessageIdRemapEvent,
} from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import { ChatsGateway } from './chats.gateway'
import { NotificationsService } from '../notifications/notifications.service'

@Injectable()
export class ChatsService implements OnModuleInit, OnModuleDestroy {
  private historyEvents!: QueueEvents
  private editEvents!: QueueEvents
  private deleteEvents!: QueueEvents

  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @InjectQueue(REDIS_QUEUES.tgOutgoing) private outgoingQueue: Queue<TgOutgoingJob>,
    @InjectQueue(REDIS_QUEUES.tgHistoryRequest) private historyQueue: Queue<TgHistoryRequestJob, TgHistoryResponse>,
    @InjectQueue(REDIS_QUEUES.tgEdit) private editQueue: Queue<TgEditJob>,
    @InjectQueue(REDIS_QUEUES.tgDelete) private deleteQueue: Queue<TgDeleteJob>,
    private configService: ConfigService,
    @Optional() private gateway: ChatsGateway,
    @Optional() private notifications?: NotificationsService,
  ) {}

  async onModuleInit() {
    const url = new URL(this.configService.get('REDIS_URL', 'redis://localhost:6379'))
    const connection = { host: url.hostname, port: Number(url.port) || 6379 }
    this.historyEvents = new QueueEvents(REDIS_QUEUES.tgHistoryRequest, { connection })
    this.editEvents = new QueueEvents(REDIS_QUEUES.tgEdit, { connection })
    this.deleteEvents = new QueueEvents(REDIS_QUEUES.tgDelete, { connection })
  }

  async onModuleDestroy() {
    await this.historyEvents?.close().catch(() => {})
    await this.editEvents?.close().catch(() => {})
    await this.deleteEvents?.close().catch(() => {})
  }

  async processIncomingEvent(event: TgMessageEvent) {
    // 1. Upsert client (the other party — always derived from chat_id)
    const [client] = await this.db
      .insert(schema.clients)
      .values({
        telegramId: event.client.telegramId,
        firstName: event.client.firstName,
        lastName: event.client.lastName ?? null,
        username: event.client.username ?? null,
      })
      .onConflictDoUpdate({
        target: schema.clients.telegramId,
        set: {
          firstName: event.client.firstName,
          lastName: event.client.lastName ?? null,
          username: event.client.username ?? null,
          updatedAt: new Date(),
        },
      })
      .returning()

    // 2. Find existing chat or create new one
    let chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.clientId, client.id),
      orderBy: (c, { desc }) => desc(c.createdAt),
    })

    if (!chat) {
      // Fresh chat: if the FIRST message we see is from the manager (e.g. our
      // own reply pulled in by sync), the chat is already 'active' — never 'new'.
      const initialStatus: schema.ChatStatus = event.isOutgoing ? 'active' : 'new'
      const [newChat] = await this.db
        .insert(schema.chats)
        .values({ clientId: client.id, status: initialStatus })
        .returning()
      chat = newChat
    } else if (chat.status === 'closed') {
      // Reopen — manager already worked this lead, treat as 'active' (not 'new')
      const prev = chat.status
      const [reopened] = await this.db
        .update(schema.chats)
        .set({ status: 'active', closedAt: null, updatedAt: new Date() })
        .where(eq(schema.chats.id, chat.id))
        .returning()
      chat = reopened
      await this.logStatusChange(chat.id, null, prev, 'active', {
        trigger: event.isOutgoing ? 'manager_message' : 'client_message',
      })
    } else if (chat.status === 'new' && event.isOutgoing) {
      const prev = chat.status
      const [activated] = await this.db
        .update(schema.chats)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(schema.chats.id, chat.id))
        .returning()
      chat = activated
      await this.logStatusChange(chat.id, null, prev, 'active', { trigger: 'manager_message' })
    }

    // 3. For outgoing text messages, check if it's an echo of a CRM-sent message
    // (sendMessage saves with status='sending'; we sync the real Telegram ID here).
    // Match the OLDEST 'sending' placeholder with the same text — FIFO order matches
    // how tg-worker drains the outgoing queue.
    if (event.isOutgoing && event.content.type === 'text') {
      const [echoed] = await this.db
        .select()
        .from(schema.messages)
        .where(and(
          eq(schema.messages.chatId, chat.id),
          eq(schema.messages.senderType, 'manager'),
          eq(schema.messages.status, 'sending'),
          sql`${schema.messages.content}->>'text' = ${event.content.text}`,
        ))
        .orderBy(schema.messages.createdAt)
        .limit(1)

      if (echoed) {
        await this.db
          .update(schema.messages)
          .set({ telegramMessageId: event.messageId, status: 'sent' })
          .where(eq(schema.messages.id, echoed.id))
        // Tell the CRM the optimistic "отправляется…" bubble is now delivered.
        this.gateway?.emitMessageStatus({
          id: echoed.id,
          chatId: chat.id,
          status: 'sent',
          telegramMessageId: event.messageId,
        })
        return // already shown via sendMessage API response
      }
    }

    // 4. Insert message (ON CONFLICT DO NOTHING — dedup by telegramMessageId)
    // Map TgMessageContent.type → DB enum (some shared variants don't have
    // their own enum value, like 'videoNote' which falls under 'video').
    const contentType: schema.ContentType =
      event.content.type === 'videoNote' ? 'video' : (event.content.type as schema.ContentType)
    const isNewChat = !chat.lastMessageAt
    const senderType = event.isOutgoing ? 'manager' : 'client'

    const [message] = await this.db
      .insert(schema.messages)
      .values({
        chatId: chat.id,
        telegramMessageId: event.messageId,
        senderType,
        // Outgoing TDLib echoes (e.g. media from CRM, messages from the manager's
        // phone) don't carry a user_id — attribute to whoever owns the chat at
        // this moment. Without this the chat-list preview falls back to
        // "Менеджер: " instead of the actual sender's name.
        senderId: event.isOutgoing ? chat.assignedTo ?? null : null,
        contentType,
        content: event.content,
        isRead: event.isOutgoing,
        status: 'sent',
        createdAt: new Date(event.date * 1000),
        replyToTgId: event.replyToMessageId ?? null,
      })
      .onConflictDoNothing()
      .returning()

    if (!message) return // duplicate — already processed

    // 4. Auto-distribute — for incoming client messages in a `new` chat with no
    // owner, pick the least-loaded online employee and assign them. Status
    // stays `new` until the manager actually responds (then sendMessage flips
    // it to `active`). This way the chat list still surfaces it as "fresh".
    let autoAssignedTo: string | null = null
    if (!event.isOutgoing && chat.status === 'new' && !chat.assignedTo) {
      autoAssignedTo = await this.pickAssignee()
      if (autoAssignedTo) {
        await this.db.update(schema.chats)
          .set({ assignedTo: autoAssignedTo, updatedAt: new Date() })
          .where(eq(schema.chats.id, chat.id))
        await this.db.insert(schema.actionLogs).values({
          action: 'chat_assigned',
          actorId: null,
          chatId: chat.id,
          metadata: { to: autoAssignedTo, reason: 'auto_distribute' },
        })
        chat = { ...chat, assignedTo: autoAssignedTo }
        console.log(`[api] auto-distributed chat ${chat.id} → user ${autoAssignedTo}`)
      }
    }

    // 5. Update chat stats. Prefer Telegram's authoritative unread_count when
    // available (avoids overcount when updateChatReadInbox races with
    // updateNewMessage); fall back to a local +1 increment otherwise.
    // EXCEPTION: brand-new chat → always 1. TDLib's unread_count can include
    // history we don't have (e.g. after a fresh DB reset) which would
    // inflate our badge from the very first message.
    const newUnreadCount = event.isOutgoing
      ? chat.unreadCount
      : isNewChat
        ? 1
        : event.unreadCount ?? chat.unreadCount + 1
    await this.db
      .update(schema.chats)
      .set({
        ...(event.isOutgoing ? {} : { unreadCount: newUnreadCount }),
        lastMessageAt: message.createdAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.chats.id, chat.id))

    // Pull assignedUser relation for emits — frontend needs it to render the
    // owner badge in the chat list without a separate fetch.
    const assignedUser = chat.assignedTo
      ? await this.db.query.users.findFirst({
          where: (u, { eq }) => eq(u.id, chat.assignedTo!),
          columns: { id: true, firstName: true, username: true },
        })
      : null

    // 6. Realtime push — emit chat:new FIRST so the chat exists in the
    // frontend's list before message:new tries to update it.
    console.log(`[api] processIncomingEvent: emitting for chat ${chat.id} (isNew=${isNewChat}, gateway=${!!this.gateway}, auto=${!!autoAssignedTo})`)
    if (isNewChat) {
      this.gateway?.emitNewChat({
        ...chat, client,
        assignedUser,
        unreadCount: newUnreadCount,
        lastMessageAt: message.createdAt,
        lastMessage: message,
      })
    } else {
      this.gateway?.emitChatUpdated({
        id: chat.id,
        status: chat.status, // include in case it was reopened (closed→active) or upgraded (new→active)
        ...(autoAssignedTo ? { assignedTo: autoAssignedTo, assignedUser } : {}),
        unreadCount: newUnreadCount,
        lastMessageAt: message.createdAt,
        lastMessage: message,
      })
    }
    this.gateway?.emitNewMessage(chat.id, { ...message, client })

    // 7. Browser push (spec 10.2): a client message goes to the responsible
    // manager; an unassigned new chat (everyone offline) goes to admins. The
    // service worker suppresses the toast if the app window is already focused.
    if (!event.isOutgoing && this.notifications) {
      const name = [client.firstName, client.lastName].filter(Boolean).join(' ') || 'Клиент'
      const payload = {
        title: name,
        body: this.messagePreview(event.content),
        chatId: chat.id,
        tag: chat.id,
      }
      if (chat.assignedTo) {
        this.notifications.sendToUser(chat.assignedTo, payload).catch(() => {})
      } else {
        this.notifications.sendToAdmins(payload).catch(() => {})
      }
    }

    return { client, chat, message }
  }

  /** One-line preview of a message for notifications / list previews. */
  private messagePreview(content: any): string {
    switch (content?.type) {
      case 'text':      return content.text?.slice(0, 120) ?? ''
      case 'photo':     return '📷 Фото' + (content.caption ? `: ${content.caption}` : '')
      case 'video':     return '🎥 Видео' + (content.caption ? `: ${content.caption}` : '')
      case 'voice':     return '🎤 Голосовое сообщение'
      case 'videoNote': return '⭕ Видеосообщение'
      case 'document':  return '📎 ' + (content.fileName || 'Файл')
      case 'sticker':   return (content.emoji || '🎁') + ' Стикер'
      default:          return 'Новое сообщение'
    }
  }

  /**
   * Frees up chats currently assigned to this user — sends `assignedTo=null`
   * for active/new chats and broadcasts so admins see them flip to "в очереди"
   * immediately. Closed chats keep their assignment (historical record).
   * Returns the count of released chats.
   */
  async releaseChatsAssignedTo(userId: string): Promise<number> {
    const released = await this.db
      .update(schema.chats)
      .set({ assignedTo: null, status: 'new', updatedAt: new Date() })
      .where(and(
        eq(schema.chats.assignedTo, userId),
        sql`${schema.chats.status} IN ('new', 'active')`,
      ))
      .returning({ id: schema.chats.id })

    for (const r of released) {
      this.gateway?.emitChatUpdated({
        id: r.id,
        status: 'new',
        assignedTo: null,
        assignedUser: null,
      })
    }
    return released.length
  }

  /**
   * Drains the `new`+unassigned queue by re-running pickAssignee per chat.
   * Called when a user comes online — they should help take pending chats.
   * Each iteration re-picks: load balancing accounts for the assignments we
   * just made, so a single returning manager doesn't get flooded if others
   * are also online.
   */
  async distributeQueuedChats(): Promise<void> {
    const queued = await this.db.query.chats.findMany({
      where: (c, { eq, and, isNull }) => and(eq(c.status, 'new'), isNull(c.assignedTo)),
      orderBy: (c, { asc }) => asc(c.createdAt),
      limit: 50,    // safety bound
    })
    if (queued.length === 0) return

    for (const chat of queued) {
      const assignee = await this.pickAssignee()
      if (!assignee) return     // nobody online anymore — stop

      await this.db.update(schema.chats)
        .set({ assignedTo: assignee, updatedAt: new Date() })
        .where(eq(schema.chats.id, chat.id))
      await this.db.insert(schema.actionLogs).values({
        action: 'chat_assigned',
        actorId: null,
        chatId: chat.id,
        metadata: { to: assignee, reason: 'auto_distribute_on_online' },
      })

      const assignedUser = await this.db.query.users.findFirst({
        where: (u, { eq }) => eq(u.id, assignee),
        columns: { id: true, firstName: true, username: true },
      })
      this.gateway?.emitChatUpdated({
        id: chat.id,
        assignedTo: assignee,
        assignedUser,
      })
      console.log(`[api] drained queued chat ${chat.id} → ${assignee}`)
    }
  }

  /**
   * Auto-distribution: pick the online employee with the fewest active chats.
   * Returns null if no one is online. Ties broken by user.id (stable but
   * arbitrary) — sufficient for now; can swap to round-robin later.
   */
  async pickAssignee(): Promise<string | null> {
    const online = await this.db.query.users.findMany({
      where: (u, { eq, and, isNull }) => and(
        eq(u.status, 'online'),
        isNull(u.deletedAt),
      ),
      columns: { id: true },
    })
    if (online.length === 0) return null

    const counts = await this.db.execute<{ user_id: string; cnt: string }>(sql`
      SELECT assigned_to as user_id, COUNT(*)::text as cnt
      FROM ${schema.chats}
      WHERE status IN ('new', 'active') AND assigned_to IS NOT NULL
      GROUP BY assigned_to
    `)
    const countByUser = new Map(counts.rows.map(r => [r.user_id, Number(r.cnt)]))

    let bestId: string | null = null
    let bestCount = Infinity
    for (const u of online) {
      const c = countByUser.get(u.id) ?? 0
      if (c < bestCount) { bestCount = c; bestId = u.id }
    }
    return bestId
  }

  /**
   * Paginated, filterable chat list (spec 5.1–5.2).
   *  - cursor pagination, `limit` rows per page (default 30)
   *  - filters: status, responsible manager (admin only), last-message date range
   *  - search: client name/username OR message text (ILIKE)
   * Returns `{ items, nextCursor }`; `nextCursor` is null when the last page is reached.
   *
   * Sort key is `coalesce(last_message_at, created_at)` (never null) with `id` as a
   * tiebreaker, so "load more" can't skip or duplicate rows at a page boundary.
   */
  async findAll(
    userId: string,
    role: string,
    opts: {
      limit?: string
      cursor?: string
      status?: 'new' | 'active' | 'closed'
      assignedTo?: string      // uuid | 'unassigned'
      dateFrom?: string
      dateTo?: string
      q?: string
    } = {},
  ): Promise<{ items: any[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(parseInt(opts.limit ?? '30', 10) || 30, 1), 100)
    const sortKey = sql`coalesce(${schema.chats.lastMessageAt}, ${schema.chats.createdAt})`

    const conds: any[] = []

    // Managers are scoped to their own chats; admins see everything.
    if (role === 'manager') {
      conds.push(eq(schema.chats.assignedTo, userId))
    } else if (opts.assignedTo === 'unassigned') {
      conds.push(isNull(schema.chats.assignedTo))
    } else if (opts.assignedTo) {
      conds.push(eq(schema.chats.assignedTo, opts.assignedTo))
    }

    if (opts.status) conds.push(eq(schema.chats.status, opts.status))
    if (opts.dateFrom) conds.push(sql`${sortKey} >= ${new Date(opts.dateFrom)}`)
    if (opts.dateTo) conds.push(sql`${sortKey} <= ${new Date(opts.dateTo)}`)

    const q = opts.q?.trim()
    if (q) {
      const like = `%${q}%`
      conds.push(or(
        ilike(schema.clients.firstName, like),
        ilike(schema.clients.lastName, like),
        ilike(schema.clients.username, like),
        sql`EXISTS (SELECT 1 FROM ${schema.messages} m WHERE m.chat_id = ${schema.chats.id} AND m.content->>'text' ILIKE ${like})`,
      ))
    }

    if (opts.cursor) {
      const [skMs, id] = opts.cursor.split('_')
      const ts = new Date(Number(skMs))
      conds.push(sql`(${sortKey} < ${ts} OR (${sortKey} = ${ts} AND ${schema.chats.id} < ${id}::uuid))`)
    }

    // Page of ordered chat IDs (join clients so name/username search can match).
    const rows = await this.db
      .select({ id: schema.chats.id, sk: sortKey })
      .from(schema.chats)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.chats.clientId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(sortKey), desc(schema.chats.id))
      .limit(limit)

    if (rows.length === 0) return { items: [], nextCursor: null }

    // Hydrate with relations, preserving the page order.
    const ids = rows.map((r) => r.id)
    const full = await this.db.query.chats.findMany({
      where: (c, { inArray }) => inArray(c.id, ids),
      with: {
        client: true,
        assignedUser: { columns: { id: true, firstName: true, username: true } },
      },
    })
    const byId = new Map(full.map((c) => [c.id, c]))
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof full

    const lastMessages = await Promise.all(
      ordered.map((chat) =>
        this.db.query.messages.findFirst({
          where: (m, { eq }) => eq(m.chatId, chat.id),
          orderBy: (m, { desc }) => desc(m.createdAt),
        }),
      ),
    )
    const items = ordered.map((chat, i) => ({ ...chat, lastMessage: lastMessages[i] ?? null }))

    const tail = rows[rows.length - 1]!
    const nextCursor = rows.length === limit
      ? `${new Date(tail.sk as string | Date).getTime()}_${tail.id}`
      : null

    return { items, nextCursor }
  }

  async findOne(chatId: string) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: {
        client: true,
        assignedUser: { columns: { id: true, firstName: true, username: true } },
      },
    })
    if (!chat) return null

    // Fetch the 50 MOST RECENT messages, then reverse to chronological order
    // (oldest at top, newest at bottom — typical chat display).
    const recent = await this.db.query.messages.findMany({
      where: (m, { eq }) => eq(m.chatId, chatId),
      orderBy: (m, { desc }) => desc(m.createdAt),
      limit: 50,
    })

    return { ...chat, messages: recent.reverse() }
  }

  async getMessages(chatId: string, before?: string) {
    return this.db.query.messages.findMany({
      where: before
        ? (m, { eq, lt, and }) => and(eq(m.chatId, chatId), eq(m.isDeleted, false), lt(m.createdAt, new Date(before)))
        : (m, { eq, and }) => and(eq(m.chatId, chatId), eq(m.isDeleted, false)),
      orderBy: (m, { desc }) => desc(m.createdAt),
      limit: 50,
    })
  }

  /**
   * Pulls older chat history from Telegram via tg-worker and stores it.
   * @param chatId CRM chat UUID
   * @param beforeTgId Telegram message ID — fetch messages older than this; 0 = latest
   * @returns Newly inserted messages (oldest → newest)
   */
  async syncHistory(chatId: string, beforeTgId: number = 0, limit: number = 50) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: { client: true },
    })
    if (!chat) throw new Error('Chat not found')

    const job = await this.historyQueue.add('fetch', {
      chatId: chat.client.telegramId,
      fromMessageId: beforeTgId,
      limit,
    })

    let result: TgHistoryResponse
    try {
      result = await job.waitUntilFinished(this.historyEvents, 15_000)
    } catch (e) {
      throw new Error(`History sync timed out or failed: ${(e as Error).message}`)
    }

    if (result.messages.length === 0) return []

    const rows = result.messages.map((m) => ({
      chatId: chat.id,
      telegramMessageId: m.messageId,
      senderType: (m.isOutgoing ? 'manager' : 'client') as 'manager' | 'client',
      contentType: m.content.type as schema.ContentType,
      content: m.content,
      isRead: true,
      status: 'sent' as const,
      createdAt: new Date(m.date * 1000),
    }))

    const inserted = await this.db
      .insert(schema.messages)
      .values(rows)
      .onConflictDoNothing()
      .returning()

    // Return all messages from the requested range (inserted + already-existing),
    // sorted oldest → newest so the frontend can prepend in chronological order.
    return [...inserted].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  }

  async assign(chatId: string, userId: string) {
    const prev = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      columns: { status: true },
    })

    await this.db
      .update(schema.chats)
      .set({ assignedTo: userId, status: 'active', updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))

    // Record "взял в работу" so it shows up in the client history timeline.
    if (prev && prev.status !== 'active') {
      await this.logStatusChange(chatId, userId, prev.status, 'active', { trigger: 'taken_into_work' })
    }

    // Return with assignedUser populated so the frontend tag updates immediately.
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: {
        assignedUser: { columns: { id: true, firstName: true, username: true } },
      },
    })

    // Broadcast so admins (and any other connected session) see the change in
    // real-time — otherwise their chat list shows the chat as "в очереди"
    // until they refresh.
    if (chat) {
      this.gateway?.emitChatUpdated({
        id: chat.id,
        status: chat.status,
        assignedTo: chat.assignedTo,
        assignedUser: chat.assignedUser,
      })
    }
    return chat
  }

  /**
   * Manual transfer (spec 8): hand a chat to another employee or return it to
   * the queue. A comment (≥10 chars) is mandatory; the recipient sees it as a
   * system note in the timeline and gets a push. Owner or admin only.
   */
  async transfer(
    chatId: string,
    actorId: string,
    actorRole: 'admin' | 'manager',
    toUserId: string | null,
    comment: string,
  ) {
    const note = (comment ?? '').trim()
    if (note.length < 10) {
      throw new BadRequestException('Комментарий обязателен — минимум 10 символов')
    }

    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: { client: true },
    })
    if (!chat) throw new NotFoundException('Чат не найден')

    // Managers can only transfer chats they own; admins can transfer anything.
    if (actorRole !== 'admin' && chat.assignedTo !== actorId) {
      throw new ForbiddenException('Можно передавать только свои чаты')
    }

    const fromUserId = chat.assignedTo

    if (toUserId) {
      const target = await this.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, toUserId) })
      if (!target || target.deletedAt) throw new BadRequestException('Сотрудник не найден')
      if (toUserId === fromUserId) throw new BadRequestException('Чат уже у этого сотрудника')
    }

    // Either way the chat becomes 'new' so the recipient (or the queue) sees it
    // as a fresh chat to take into work — on reassign the owner is the target,
    // on queue-return the owner is cleared.
    await this.db.update(schema.chats).set(
      toUserId
        ? { assignedTo: toUserId, status: 'new', updatedAt: new Date() }
        : { assignedTo: null, status: 'new', updatedAt: new Date() },
    ).where(eq(schema.chats.id, chatId))

    await this.db.insert(schema.chatTransfers).values({
      chatId,
      fromUserId: fromUserId ?? null,
      toUserId: toUserId ?? null,
      comment: note,
      createdBy: actorId,
    })
    await this.db.insert(schema.actionLogs).values({
      action: 'chat_transferred',
      actorId,
      chatId,
      metadata: { from: fromUserId, to: toUserId, comment: note, mode: toUserId ? 'reassign' : 'queue' },
    })

    // System note in the timeline — the recipient sees the comment in context.
    const fromUser = fromUserId
      ? await this.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, fromUserId), columns: { firstName: true } })
      : null
    const fromName = fromUser?.firstName ?? null
    const text = toUserId
      ? `🔄 Чат передан${fromName ? ` от ${fromName}` : ''}: ${note}`
      : `↩️ Чат возвращён в очередь${fromName ? ` (${fromName})` : ''}: ${note}`
    const [sysMsg] = await this.db.insert(schema.messages).values({
      chatId,
      telegramMessageId: Date.now(),
      senderType: 'system',
      senderId: actorId,
      contentType: 'text',
      content: { type: 'text', text },
      isRead: true,
      status: 'sent',
      createdAt: new Date(),
    }).returning()

    const updated = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: { assignedUser: { columns: { id: true, firstName: true, username: true } } },
    })

    this.gateway?.emitChatUpdated({
      id: chatId,
      status: updated?.status,
      assignedTo: updated?.assignedTo ?? null,
      assignedUser: updated?.assignedUser ?? null,
    })
    this.gateway?.emitNewMessage(chatId, { ...sysMsg, client: chat.client })

    // Notify the receiving employee (spec 10.2: "Чат передан менеджеру").
    if (toUserId) {
      const clientName = [chat.client.firstName, chat.client.lastName].filter(Boolean).join(' ') || 'Клиент'
      const title = `Вам передали чат: ${clientName}`
      this.notifications?.sendToUser(toUserId, { title, body: note, chatId, tag: chatId, force: true }).catch(() => {})
      // In-app notification (center + toast) — reliable regardless of OS push.
      this.gateway?.emitToUsers([toUserId], 'notify', { type: 'transfer', title, body: note, chatId })
    }

    return updated
  }

  private async logStatusChange(
    chatId: string,
    actorId: string | null,
    from: 'new' | 'active' | 'closed',
    to: 'new' | 'active' | 'closed',
    extra: Record<string, unknown> = {},
  ) {
    await this.db.insert(schema.actionLogs).values({
      action: 'chat_status_changed',
      actorId,
      chatId,
      metadata: { from, to, ...extra },
    }).catch(() => {})
  }

  /**
   * Ensures admin actions always attribute a chat to someone:
   *  - if chat has another owner → transfer to admin (logged as chat_transferred)
   *  - if chat has no owner       → claim for admin (logged as chat_assigned)
   *  - otherwise (already mine or actor isn't admin) → noop
   *
   * Returns true if ownership changed (caller may want to include assigned_to
   * in the WS payload).
   */
  private async maybeAdminTakeover(
    chatId: string,
    currentAssignedTo: string | null,
    actorId: string,
    actorRole: 'admin' | 'manager',
  ): Promise<boolean> {
    if (actorRole !== 'admin') return false
    if (currentAssignedTo === actorId) return false

    const isClaim = !currentAssignedTo
    await this.db.insert(schema.actionLogs).values({
      action: isClaim ? 'chat_assigned' : 'chat_transferred',
      actorId,
      chatId,
      metadata: isClaim
        ? { to: actorId, reason: 'admin_claim' }
        : { from: currentAssignedTo, to: actorId, reason: 'admin_action' },
    })
    await this.db.update(schema.chats)
      .set({ assignedTo: actorId, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))

    // Include the new owner's display info so the chat-list tag updates
    // immediately in the UI without needing a refetch.
    const actor = await this.db.query.users.findFirst({
      where: eq(schema.users.id, actorId),
      columns: { id: true, firstName: true, username: true },
    })
    this.gateway?.emitChatUpdated({
      id: chatId,
      assignedTo: actorId,
      assignedUser: actor ?? null,
    })
    return true
  }

  async reopen(chatId: string, userId: string, userRole: 'admin' | 'manager') {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
    })
    if (!chat) throw new Error('Chat not found')
    if (chat.status !== 'closed') return chat // no-op

    await this.maybeAdminTakeover(chatId, chat.assignedTo, userId, userRole)

    const [updated] = await this.db
      .update(schema.chats)
      .set({ status: 'active', closedAt: null, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))
      .returning()

    await this.logStatusChange(chatId, userId, 'closed', 'active', { trigger: 'manual_reopen' })

    this.gateway?.emitChatUpdated({ id: chatId, status: 'active' })
    return updated
  }

  async close(chatId: string, userId: string, userRole: 'admin' | 'manager', result?: {
    status: 'thinking' | 'consulting' | 'waiting_price' | 'booked' | 'bought'
    flightFrom?: string
    flightTo?: string
    dates?: string
    amount?: number
    comment?: string
  }) {
    if (result) {
      const flight = [result.flightFrom?.trim(), result.flightTo?.trim()]
        .filter(Boolean)
        .join(' → ') || null
      await this.db
        .insert(schema.chatResults)
        .values({
          chatId,
          clientStatus: result.status,
          flight,
          dates: result.dates ?? null,
          amount: result.amount != null ? String(result.amount) : null,
          comment: result.comment ?? null,
          createdBy: userId,
        })
        .onConflictDoUpdate({
          target: schema.chatResults.chatId,
          set: {
            clientStatus: result.status,
            flight,
            dates: result.dates ?? null,
            amount: result.amount != null ? String(result.amount) : null,
            comment: result.comment ?? null,
            updatedAt: new Date(),
          },
        })
    }

    const prev = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      columns: { status: true, assignedTo: true },
    })
    await this.maybeAdminTakeover(chatId, prev?.assignedTo ?? null, userId, userRole)
    const [chat] = await this.db
      .update(schema.chats)
      .set({ status: 'closed', closedAt: new Date(), unreadCount: 0, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))
      .returning()

    if (prev && prev.status !== 'closed') {
      const flight = result
        ? [result.flightFrom?.trim(), result.flightTo?.trim()].filter(Boolean).join(' → ') || null
        : null
      await this.logStatusChange(chatId, userId, prev.status, 'closed', {
        trigger: 'manual_close',
        clientStatus: result?.status,
        flight,
        dates: result?.dates ?? null,
        amount: result?.amount != null ? String(result.amount) : null,
        comment: result?.comment ?? null,
      })
    }

    this.gateway?.emitChatUpdated({
      id: chat.id,
      status: chat.status,
      unreadCount: 0,
    })

    return chat
  }

  async getClientInfo(chatId: string) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: {
        client: true,
        assignedUser: { columns: { id: true, firstName: true, username: true } },
      },
    })
    if (!chat) return null

    const allChats = await this.db.query.chats.findMany({
      where: (c, { eq }) => eq(c.clientId, chat.client.id),
      with: { result: true },
      orderBy: (c, { asc }) => asc(c.createdAt),
    })

    // All status-change events across this client's chats
    const chatIds = allChats.map((c) => c.id)
    const logs = chatIds.length
      ? await this.db.query.actionLogs.findMany({
          where: (l, { inArray }) => inArray(l.chatId, chatIds),
          orderBy: (l, { desc }) => desc(l.createdAt),
        })
      : []

    type TimelineItem =
      | {
          type: 'closed'
          date: string
          clientStatus: string
          flight: string | null
          amount: string | null
          dates: string | null
          comment: string | null
        }
      | { type: 'reopened'; date: string; trigger?: string }
      | { type: 'taken'; date: string }
      | { type: 'transferred'; date: string; fromName: string | null; toName: string | null; comment: string | null; mode: 'reassign' | 'queue' }
      | { type: 'first_contact'; date: string }
    const timeline: TimelineItem[] = []

    // Resolve user ids → names for transfer entries (small table; load once).
    const hasTransfers = logs.some((l) => l.action === 'chat_transferred')
    const userNames = new Map<string, string>()
    if (hasTransfers) {
      const users = await this.db.query.users.findMany({ columns: { id: true, firstName: true } })
      for (const u of users) userNames.set(u.id, u.firstName)
    }

    // Each close-event becomes its own timeline entry with its own metadata,
    // so multiple closes of the same chat (close → reopen → close again) all show up.
    for (const log of logs) {
      const meta = log.metadata as any
      if (log.action === 'chat_transferred') {
        timeline.push({
          type: 'transferred',
          date: log.createdAt.toISOString(),
          fromName: meta?.from ? userNames.get(meta.from) ?? null : null,
          toName: meta?.to ? userNames.get(meta.to) ?? null : null,
          comment: meta?.comment ?? null,
          mode: meta?.to ? 'reassign' : 'queue',
        })
        continue
      }
      if (log.action !== 'chat_status_changed') continue
      if (meta?.to === 'closed' && meta?.clientStatus) {
        timeline.push({
          type: 'closed',
          date: log.createdAt.toISOString(),
          clientStatus: meta.clientStatus,
          flight: meta.flight ?? null,
          amount: meta.amount ?? null,
          dates: meta.dates ?? null,
          comment: meta.comment ?? null,
        })
      } else if (meta?.to === 'active' && meta?.from === 'closed') {
        timeline.push({
          type: 'reopened',
          date: log.createdAt.toISOString(),
          trigger: meta?.trigger,
        })
      } else if (meta?.to === 'active' && meta?.from === 'new') {
        timeline.push({
          type: 'taken',
          date: log.createdAt.toISOString(),
        })
      }
    }
    timeline.push({
      type: 'first_contact',
      date: (allChats[0]?.createdAt ?? chat.createdAt).toISOString(),
    })
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // "Current" status pill = most recent closed event for this chat
    const latestCloseForThisChat = logs.find((l) => {
      const m = l.metadata as any
      return l.chatId === chatId && l.action === 'chat_status_changed' && m?.to === 'closed' && m?.clientStatus
    })
    const currentChatResult = latestCloseForThisChat
      ? {
          clientStatus: (latestCloseForThisChat.metadata as any).clientStatus,
          flight: (latestCloseForThisChat.metadata as any).flight ?? null,
          dates: (latestCloseForThisChat.metadata as any).dates ?? null,
          amount: (latestCloseForThisChat.metadata as any).amount ?? null,
          comment: (latestCloseForThisChat.metadata as any).comment ?? null,
        }
      : (allChats.find((c) => c.id === chatId)?.result ?? null)

    const latestClosedEvent = timeline.find((t) => t.type === 'closed') as Extract<TimelineItem, { type: 'closed' }> | undefined

    return {
      client: chat.client,
      assignedUser: chat.assignedUser,
      totalDialogs: allChats.length,
      firstContactAt: allChats[0]?.createdAt ?? chat.createdAt,
      latestStatus: latestClosedEvent?.clientStatus ?? null,
      currentChatResult,
      timeline,
    }
  }

  async sendMessage(
    chatId: string,
    text: string,
    senderId: string,
    senderRole: 'admin' | 'manager',
    replyToMessageId?: string,
  ) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: { client: true },
    })
    if (!chat) throw new Error('Chat not found')

    // Resolve UUID → TG message id for the reply target (if any)
    let replyTo: number | undefined
    if (replyToMessageId) {
      const target = await this.db.query.messages.findFirst({
        where: (m, { eq, and }) => and(eq(m.id, replyToMessageId), eq(m.chatId, chatId)),
        columns: { telegramMessageId: true },
      })
      if (target) replyTo = target.telegramMessageId
    }

    await this.outgoingQueue.add('send', {
      chatId: chat.client.telegramId,
      content: { type: 'text', text },
      replyToMessageId: replyTo,
    })

    const [message] = await this.db
      .insert(schema.messages)
      .values({
        chatId,
        telegramMessageId: Date.now(),
        senderType: 'manager',
        senderId,
        contentType: 'text',
        content: { type: 'text', text },
        isRead: true,
        status: 'sending', // marker — replaced with 'sent' + real Telegram ID when TDLib echoes back
        createdAt: new Date(),
        replyToTgId: replyTo ?? null,
      })
      .returning()

    // If the chat was closed and the manager replied, reopen it as 'active'
    // immediately (don't wait for the TDLib echo to update status).
    const statusUpdate = chat.status === 'closed' ? { status: 'active' as const, closedAt: null } : {}
    // Ownership rules:
    //  - unassigned → claim for sender
    //  - admin replied to someone else's chat → admin takes it over
    //    (admin intervening is implicit reassignment — they wouldn't be writing
    //    in another manager's chat by accident)
    const adminTakingOver = senderRole === 'admin' && chat.assignedTo && chat.assignedTo !== senderId
    const ownerUpdate = (!chat.assignedTo || adminTakingOver) ? { assignedTo: senderId } : {}
    if (adminTakingOver) {
      await this.db.insert(schema.actionLogs).values({
        action: 'chat_transferred',
        actorId: senderId,
        chatId,
        metadata: { from: chat.assignedTo, to: senderId, reason: 'admin_reply' },
      })
    }
    await this.db
      .update(schema.chats)
      .set({ ...statusUpdate, ...ownerUpdate, lastMessageAt: message.createdAt, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))

    // Manager engaged → mark everything before this as read (clears unread badge
    // AND sends viewMessages to Telegram so the client sees double-check).
    await this.markRead(chatId)

    // If ownership changed, fetch the new owner's display info so the chat-list
    // badge updates without a refetch.
    const newOwnerInfo = ownerUpdate.assignedTo
      ? await this.db.query.users.findFirst({
          where: eq(schema.users.id, senderId),
          columns: { id: true, firstName: true, username: true },
        })
      : null

    // Broadcast so all open CRM clients (other managers, other tabs) see the message
    this.gateway?.emitNewMessage(chatId, { ...message, client: chat.client })
    this.gateway?.emitChatUpdated({
      id: chatId,
      ...(chat.status === 'closed' ? { status: 'active' } : {}),
      ...(ownerUpdate as { assignedTo?: string }),
      ...(newOwnerInfo ? { assignedUser: newOwnerInfo } : {}),
      unreadCount: 0,
      lastMessageAt: message.createdAt,
      lastMessage: message,
    })

    // The message keeps its own delivery status ('sending'); the chat reopen
    // (closed → active) is communicated separately via emitChatUpdated above.
    return message
  }

  async markRead(chatId: string) {
    // Collect unread client messages BEFORE clearing — we need their Telegram IDs
    // to mark them as read on the Telegram side too (so the user sees double-check).
    const unreadClientMessages = await this.db.query.messages.findMany({
      where: (m, { eq, and }) =>
        and(eq(m.chatId, chatId), eq(m.isRead, false), eq(m.senderType, 'client')),
      columns: { telegramMessageId: true },
    })

    await this.db
      .update(schema.chats)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))

    await this.db
      .update(schema.messages)
      .set({ isRead: true })
      .where(and(eq(schema.messages.chatId, chatId), eq(schema.messages.isRead, false)))

    // Tell Telegram that the manager has read these messages (sets the "double check"
    // / removes the unread badge on the client's side).
    if (unreadClientMessages.length > 0) {
      const chat = await this.db.query.chats.findFirst({
        where: (c, { eq }) => eq(c.id, chatId),
        with: { client: true },
      })
      if (chat) {
        await this.outgoingQueue.add('viewMessages', {
          chatId: chat.client.telegramId,
          content: {
            type: 'viewMessages',
            messageIds: unreadClientMessages.map(m => m.telegramMessageId),
          },
        }).catch(() => {})
      }
    }
  }

  /**
   * Applies a "read" event coming from another Telegram client (phone, desktop).
   * Updates messages + chat counter and broadcasts the new state.
   */
  async applyExternalRead(event: TgReadSyncEvent) {
    // Find the CRM chat by the telegram user_id (= chat_id in TDLib for private chats)
    const client = await this.db.query.clients.findFirst({
      where: (c, { eq }) => eq(c.telegramId, event.chatId),
    })
    if (!client) return // not a chat we track

    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.clientId, client.id),
      orderBy: (c, { desc }) => desc(c.createdAt),
    })
    if (!chat) return

    // Mark every client message up to lastReadMessageId as read
    await this.db
      .update(schema.messages)
      .set({ isRead: true })
      .where(and(
        eq(schema.messages.chatId, chat.id),
        eq(schema.messages.senderType, 'client'),
        eq(schema.messages.isRead, false),
        sql`${schema.messages.telegramMessageId} <= ${event.lastReadMessageId}`,
      ))

    // Mirror Telegram's authoritative unread count
    if (chat.unreadCount !== event.unreadCount) {
      await this.db
        .update(schema.chats)
        .set({ unreadCount: event.unreadCount, updatedAt: new Date() })
        .where(eq(schema.chats.id, chat.id))

      this.gateway?.emitChatUpdated({ id: chat.id, unreadCount: event.unreadCount })
    }
  }

  // === File uploads from CRM ===
  async sendMedia(
    chatId: string,
    files: Array<{ filePath: string; fileName: string; mimeType: string; size: number }>,
    senderId: string,
    senderRole: 'admin' | 'manager',
    caption?: string,
  ) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: { client: true },
    })
    if (!chat) throw new Error('Chat not found')

    const tgChatId = chat.client.telegramId

    // Build the outgoing jobs. Photos/videos are grouped into Telegram albums
    // (media groups, 2-10 each); documents are sent individually. The caption
    // attaches to the first job only, mirroring Telegram's one-caption-per-album.
    const mediaKind = (m: string): 'photo' | 'video' | null =>
      m.startsWith('image/') ? 'photo' : m.startsWith('video/') ? 'video' : null
    const mediaFiles = files.filter((f) => mediaKind(f.mimeType) !== null)
    const docFiles = files.filter((f) => mediaKind(f.mimeType) === null)

    const jobs: TgOutgoingContent[] = []
    let captionLeft: string | undefined = caption
    const takeCaption = () => { const c = captionLeft; captionLeft = undefined; return c }

    // Media in chunks of 10 → album if ≥2, single photo/video otherwise.
    for (let i = 0; i < mediaFiles.length; i += 10) {
      const chunk = mediaFiles.slice(i, i + 10)
      if (chunk.length >= 2) {
        jobs.push({
          type: 'album',
          items: chunk.map((f) => ({ kind: mediaKind(f.mimeType)!, filePath: f.filePath })),
          caption: takeCaption(),
        })
      } else {
        const f = chunk[0]!
        jobs.push(mediaKind(f.mimeType) === 'video'
          ? { type: 'video', filePath: f.filePath, caption: takeCaption() }
          : { type: 'photo', filePath: f.filePath, caption: takeCaption() })
      }
    }
    for (const f of docFiles) {
      jobs.push({ type: 'document', filePath: f.filePath, fileName: f.fileName, caption: takeCaption() })
    }

    for (const content of jobs) {
      await this.outgoingQueue.add('send', { chatId: tgChatId, content })
    }

    const contentType: schema.ContentType = mediaFiles.length > 0 ? 'photo' : 'document'

    // For text we save a 'sending' placeholder; for media we wait for the TDLib
    // echo (it brings a real fileId that the /files endpoint can serve).
    // Reopen closed chats so the manager's send is reflected as "active" right away.
    const statusUpdate = chat.status === 'closed' ? { status: 'active' as const, closedAt: null } : {}
    // Same ownership rules as sendMessage: unassigned → claim; admin replying
    // to someone else's chat → admin takes over.
    const adminTakingOver = senderRole === 'admin' && chat.assignedTo && chat.assignedTo !== senderId
    const ownerUpdate = (!chat.assignedTo || adminTakingOver) ? { assignedTo: senderId } : {}
    if (adminTakingOver) {
      await this.db.insert(schema.actionLogs).values({
        action: 'chat_transferred',
        actorId: senderId,
        chatId,
        metadata: { from: chat.assignedTo, to: senderId, reason: 'admin_reply' },
      })
    }
    await this.db
      .update(schema.chats)
      .set({ ...statusUpdate, ...ownerUpdate, lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))

    // Manager engaged → clear unread + Telegram read receipts.
    await this.markRead(chatId)

    const newOwnerInfo = ownerUpdate.assignedTo
      ? await this.db.query.users.findFirst({
          where: eq(schema.users.id, senderId),
          columns: { id: true, firstName: true, username: true },
        })
      : null

    this.gateway?.emitChatUpdated({
      id: chatId,
      ...(chat.status === 'closed' ? { status: 'active' } : {}),
      ...(ownerUpdate as { assignedTo?: string }),
      ...(newOwnerInfo ? { assignedUser: newOwnerInfo } : {}),
      unreadCount: 0,
      lastMessageAt: new Date(),
    })

    return { queued: true, contentType, count: files.length }
  }

  // === Edit / Delete ===

  async editMessage(
    chatId: string,
    messageId: string,
    text: string,
    userId: string,
    userRole: 'admin' | 'manager',
  ) {
    const message = await this.db.query.messages.findFirst({
      where: (m, { eq, and }) => and(eq(m.id, messageId), eq(m.chatId, chatId)),
    })
    if (!message) throw new Error('Message not found')
    if (message.isDeleted) throw new Error('Message is deleted')
    if (message.senderType !== 'manager') {
      throw new Error('Cannot edit client messages')
    }

    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: { client: true },
    })
    if (!chat) throw new Error('Chat not found')

    await this.maybeAdminTakeover(chatId, chat.assignedTo, userId, userRole)

    // Text messages: replace `text`. Media: replace `caption`.
    const oldContent = message.content as any
    const isText = oldContent.type === 'text'
    const newContent = isText
      ? { ...oldContent, text }
      : { ...oldContent, caption: text }

    // Transactional: TDLib must succeed BEFORE we change the DB.
    // Otherwise CRM would show "edited" while the client still sees the old text.
    const job = await this.editQueue.add('edit', {
      chatId: chat.client.telegramId,
      messageId: message.telegramMessageId,
      text,
      isCaption: !isText,
    })
    try {
      await job.waitUntilFinished(this.editEvents, 30_000)
    } catch (err) {
      throw new Error(`Telegram edit failed: ${(err as Error).message}`)
    }

    const editedAt = new Date()
    const [updated] = await this.db
      .update(schema.messages)
      .set({ content: newContent, editedAt })
      .where(eq(schema.messages.id, messageId))
      .returning()

    this.gateway?.emitMessageEdited(chatId, {
      id: updated.id,
      chatId,
      content: newContent,
      editedAt: editedAt.toISOString(),
    })

    return updated
  }

  async deleteMessage(
    chatId: string,
    messageId: string,
    userId: string,
    userRole: 'admin' | 'manager',
  ) {
    const message = await this.db.query.messages.findFirst({
      where: (m, { eq, and }) => and(eq(m.id, messageId), eq(m.chatId, chatId)),
    })
    if (!message) throw new Error('Message not found')
    if (message.isDeleted) return
    if (message.senderType !== 'manager') {
      throw new Error('Cannot delete client messages')
    }

    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: { client: true },
    })
    if (!chat) throw new Error('Chat not found')

    await this.maybeAdminTakeover(chatId, chat.assignedTo, userId, userRole)

    // Wait for TDLib confirmation before soft-deleting locally.
    const job = await this.deleteQueue.add('delete', {
      chatId: chat.client.telegramId,
      messageIds: [message.telegramMessageId],
      revoke: true,
    })
    try {
      await job.waitUntilFinished(this.deleteEvents, 30_000)
    } catch (err) {
      throw new Error(`Telegram delete failed: ${(err as Error).message}`)
    }

    await this.db
      .update(schema.messages)
      .set({ isDeleted: true })
      .where(eq(schema.messages.id, messageId))

    this.gateway?.emitMessageDeleted(chatId, { ids: [messageId] })
  }

  /** Apply an edit that happened on the Telegram side (client edited their own message). */
  async applyExternalEdit(event: TgMessageEditedEvent) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, sql`(SELECT id FROM chats WHERE client_id = (SELECT id FROM clients WHERE telegram_id = ${event.chatId}))`),
    })
    if (!chat) return

    const message = await this.db.query.messages.findFirst({
      where: (m, { eq, and }) => and(eq(m.chatId, chat.id), eq(m.telegramMessageId, event.messageId)),
    })
    if (!message) return

    const editedAt = new Date(event.editDate * 1000)
    const [updated] = await this.db
      .update(schema.messages)
      .set({ content: event.content, editedAt })
      .where(eq(schema.messages.id, message.id))
      .returning()

    this.gateway?.emitMessageEdited(chat.id, {
      id: updated.id,
      chatId: chat.id,
      content: event.content,
      editedAt: editedAt.toISOString(),
    })
  }

  /** Apply a delete that happened on the Telegram side. */
  async applyExternalDelete(event: TgMessageDeletedEvent) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, sql`(SELECT id FROM chats WHERE client_id = (SELECT id FROM clients WHERE telegram_id = ${event.chatId}))`),
    })
    if (!chat) return

    const rows = await this.db.query.messages.findMany({
      where: (m, { eq, and, inArray }) => and(
        eq(m.chatId, chat.id),
        inArray(m.telegramMessageId, event.messageIds),
      ),
      columns: { id: true },
    })
    if (rows.length === 0) return

    await this.db
      .update(schema.messages)
      .set({ isDeleted: true })
      .where(and(
        eq(schema.messages.chatId, chat.id),
        sql`${schema.messages.telegramMessageId} = ANY(${event.messageIds})`,
      ))

    this.gateway?.emitMessageDeleted(chat.id, { ids: rows.map(r => r.id) })
  }

  /**
   * Remap a message row's telegram_message_id when TDLib transitions a sent
   * message from its temporary id (seen via updateNewMessage) to the
   * permanent one (via updateMessageSendSucceeded). Without this, subsequent
   * edits/deletes hit "Message not found" because we'd be using a stale id.
   */
  async remapMessageId(event: TgMessageIdRemapEvent) {
    if (event.oldMessageId === event.newMessageId) return

    // Resolve telegram chat_id (bigint) → our chat UUID
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, sql`(SELECT id FROM chats WHERE client_id = (SELECT id FROM clients WHERE telegram_id = ${event.chatId}))`),
      columns: { id: true },
    })
    if (!chat) return

    // If a row with the new id already exists (race), prefer it and drop the old one.
    const newRow = await this.db.query.messages.findFirst({
      where: (m, { eq, and }) => and(eq(m.chatId, chat.id), eq(m.telegramMessageId, event.newMessageId)),
      columns: { id: true },
    })
    if (newRow) {
      await this.db
        .delete(schema.messages)
        .where(and(
          eq(schema.messages.chatId, chat.id),
          eq(schema.messages.telegramMessageId, event.oldMessageId),
        ))
      return
    }

    await this.db
      .update(schema.messages)
      .set({ telegramMessageId: event.newMessageId })
      .where(and(
        eq(schema.messages.chatId, chat.id),
        eq(schema.messages.telegramMessageId, event.oldMessageId),
      ))
  }

}
