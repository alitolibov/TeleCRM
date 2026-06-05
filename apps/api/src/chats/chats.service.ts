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
  TgMessagePinnedEvent,
  TgClientRefreshRequest,
  TgClientRefreshResponse,
  TgPinJob,
  TgForwardJob,
  TgChatSearchRequest,
  TgChatSearchResponse,
} from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import { ChatsGateway } from './chats.gateway'
import { NotificationsService } from '../notifications/notifications.service'
import { CloseReasonsService } from '../close-reasons/close-reasons.service'

/** Compact text for the "📌 Закреплено: …" service note. Mirrors what the
 *  chat-list preview shows so the note reads like Telegram's pin-service. */
function pinNotePreview(content: any): string {
  if (!content) return '📌 Сообщение закреплено'
  const short = (s: string) => (s.length > 60 ? s.slice(0, 60) + '…' : s)
  if (content.type === 'text')     return `📌 Закреплено: ${short(content.text ?? '')}`
  if (content.type === 'photo')    return `📌 Закреплено фото${content.caption ? `: ${short(content.caption)}` : ''}`
  if (content.type === 'video')    return `📌 Закреплено видео${content.caption ? `: ${short(content.caption)}` : ''}`
  if (content.type === 'voice')    return '📌 Закреплено голосовое сообщение'
  if (content.type === 'document') return `📌 Закреплён файл${content.fileName ? `: ${short(content.fileName)}` : ''}`
  if (content.type === 'sticker')  return `📌 Закреплён стикер${content.emoji ? ` ${content.emoji}` : ''}`
  return '📌 Сообщение закреплено'
}

@Injectable()
export class ChatsService implements OnModuleInit, OnModuleDestroy {
  private historyEvents!: QueueEvents
  private editEvents!: QueueEvents
  private deleteEvents!: QueueEvents
  private clientRefreshEvents!: QueueEvents
  private chatSearchEvents!: QueueEvents

  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @InjectQueue(REDIS_QUEUES.tgOutgoing) private outgoingQueue: Queue<TgOutgoingJob>,
    @InjectQueue(REDIS_QUEUES.tgHistoryRequest) private historyQueue: Queue<TgHistoryRequestJob, TgHistoryResponse>,
    @InjectQueue(REDIS_QUEUES.tgEdit) private editQueue: Queue<TgEditJob>,
    @InjectQueue(REDIS_QUEUES.tgDelete) private deleteQueue: Queue<TgDeleteJob>,
    @InjectQueue(REDIS_QUEUES.tgClientRefresh) private clientRefreshQueue: Queue<TgClientRefreshRequest, TgClientRefreshResponse>,
    @InjectQueue(REDIS_QUEUES.tgPin) private pinQueue: Queue<TgPinJob>,
    @InjectQueue(REDIS_QUEUES.tgForward) private forwardQueue: Queue<TgForwardJob>,
    @InjectQueue(REDIS_QUEUES.tgChatSearch) private chatSearchQueue: Queue<TgChatSearchRequest, TgChatSearchResponse>,
    private configService: ConfigService,
    private closeReasons: CloseReasonsService,
    @Optional() private gateway: ChatsGateway,
    @Optional() private notifications?: NotificationsService,
  ) {}

  async onModuleInit() {
    const url = new URL(this.configService.get('REDIS_URL', 'redis://localhost:6379'))
    const connection = { host: url.hostname, port: Number(url.port) || 6379 }
    this.historyEvents = new QueueEvents(REDIS_QUEUES.tgHistoryRequest, { connection })
    this.editEvents = new QueueEvents(REDIS_QUEUES.tgEdit, { connection })
    this.deleteEvents = new QueueEvents(REDIS_QUEUES.tgDelete, { connection })
    this.clientRefreshEvents = new QueueEvents(REDIS_QUEUES.tgClientRefresh, { connection })
    this.chatSearchEvents = new QueueEvents(REDIS_QUEUES.tgChatSearch, { connection })
  }

  async onModuleDestroy() {
    await this.historyEvents?.close().catch(() => {})
    await this.editEvents?.close().catch(() => {})
    await this.deleteEvents?.close().catch(() => {})
    await this.clientRefreshEvents?.close().catch(() => {})
    await this.chatSearchEvents?.close().catch(() => {})
  }

  async processIncomingEvent(event: TgMessageEvent) {
    // 1. Upsert client (the other party — always derived from chat_id).
    //    If a saved contact exists for this client, the human-chosen first/last
    //    name win — TDLib's profile updates won't overwrite them. Username and
    //    updatedAt always refresh.
    const [client] = await this.db
      .insert(schema.clients)
      .values({
        telegramId: event.client.telegramId,
        firstName: event.client.firstName,
        lastName: event.client.lastName ?? null,
        username: event.client.username ?? null,
        phone: event.client.phone ?? null,
        inTelegramContacts: event.client.isContact ?? false,
      })
      .onConflictDoUpdate({
        target: schema.clients.telegramId,
        set: {
          firstName: sql`CASE WHEN EXISTS (SELECT 1 FROM contacts WHERE contacts.client_id = clients.id) THEN clients.first_name ELSE EXCLUDED.first_name END`,
          lastName: sql`CASE WHEN EXISTS (SELECT 1 FROM contacts WHERE contacts.client_id = clients.id) THEN clients.last_name ELSE EXCLUDED.last_name END`,
          username: event.client.username ?? null,
          // Phone only goes forward — if TDLib starts sharing a number, store
          // it; if a later event omits it (privacy toggled off again), keep
          // what we had so the CRM remembers what we once saw.
          phone: sql`COALESCE(EXCLUDED.phone, clients.phone)`,
          // TDLib contact flag DOES flip both ways — user can delete the
          // contact in their TG client and we want the button to reflect that.
          inTelegramContacts: event.client.isContact ?? false,
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
    const contentType = this.toContentType(event.content.type)
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
        forwardedFrom: event.forwardedFrom ?? null,
      })
      .onConflictDoNothing()
      .returning()

    if (!message) return // duplicate — already processed

    // 4. Auto-distribute — round-robin: an incoming client message in a `new`,
    // unowned chat goes to one idle online user (zero active chats), if any.
    // Status stays `new` until the manager actually responds (then sendMessage
    // flips it to `active`), so the chat list still surfaces it as "fresh".
    let autoAssignedTo: string | null = null
    if (!event.isOutgoing && chat.status === 'new' && !chat.assignedTo) {
      autoAssignedTo = await this.pickAssignee()
      if (autoAssignedTo) {
        await this.autoAssignChat(chat.id, autoAssignedTo, 'auto_distribute')
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
    this.gateway?.emitNewMessage(chat.id, { ...this.normalizeForwardedFrom(message), client })

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

  /**
   * Map a TgMessageContent.type to the DB content_type enum. Some shared variants
   * have no own enum value ('videoNote' → 'video'); the full type is preserved in
   * the JSONB content so the UI still renders it correctly. Unknown → 'unsupported'.
   */
  private toContentType(type: string): schema.ContentType {
    if (type === 'videoNote') return 'video'
    const valid = ['text', 'photo', 'video', 'voice', 'document', 'sticker', 'unsupported']
    return (valid.includes(type) ? type : 'unsupported') as schema.ContentType
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
   * Drains the queue one chat per eligible person. With the round-robin rule
   * (at most one active chat per online user), pickAssignee returns null once
   * every online user already holds a chat — so the loop naturally stops there
   * and the rest of the queue waits for someone to close.
   *
   * Called when a user comes online and when a chat closes.
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
      if (!assignee) return     // everyone is busy or offline — stop draining

      await this.autoAssignChat(chat.id, assignee, 'auto_distribute_on_online')

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
   * Round-robin auto-distribution: pick the online user who currently has
   * zero active chats (status `new` or `active`) and whose last auto-assign
   * is the oldest (NULLS FIRST). Role doesn't matter — admins are in the
   * rotation too.
   *
   * Returns null when everyone is either offline or already holding a chat —
   * the queue then waits for someone to close or come online.
   */
  async pickAssignee(excludeUserId?: string): Promise<string | null> {
    const result = await this.db.execute<{ id: string }>(sql`
      SELECT u.id
      FROM ${schema.users} u
      LEFT JOIN ${schema.chats} c
        ON c.assigned_to = u.id AND c.status IN ('new', 'active')
      WHERE u.status = 'online'
        AND u.deleted_at IS NULL
        ${excludeUserId ? sql`AND u.id <> ${excludeUserId}` : sql``}
      GROUP BY u.id, u.last_auto_assigned_at
      HAVING COUNT(c.id) = 0
      ORDER BY u.last_auto_assigned_at ASC NULLS FIRST, u.id ASC
      LIMIT 1
    `)
    return result.rows[0]?.id ?? null
  }

  /**
   * Persists an auto-distribution: updates the chat, advances the round-robin
   * cursor on the user, and writes the action log. Gateway emit stays at the
   * call site since each caller already builds its own broadcast payload.
   */
  private async autoAssignChat(chatId: string, userId: string, reason: string): Promise<void> {
    const now = new Date()
    await this.db.update(schema.chats)
      .set({ assignedTo: userId, updatedAt: now })
      .where(eq(schema.chats.id, chatId))
    await this.db.update(schema.users)
      .set({ lastAutoAssignedAt: now })
      .where(eq(schema.users.id, userId))
    await this.db.insert(schema.actionLogs).values({
      action: 'chat_assigned',
      actorId: null,
      chatId,
      metadata: { to: userId, reason },
    })
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

  /**
   * Saved close-results view (spec 18): closed chats with their captured result,
   * filterable by client status / manager / close-date and searchable across
   * flight, dates, amount and comment. Managers see only their own.
   */
  async searchResults(
    userId: string,
    role: string,
    opts: {
      clientStatus?: string
      assignedTo?: string
      dateFrom?: string
      dateTo?: string
      q?: string
      limit?: string
    } = {},
  ) {
    const limit = Math.min(Math.max(parseInt(opts.limit ?? '100', 10) || 100, 1), 200)
    const conds: any[] = []

    if (role === 'manager') conds.push(eq(schema.chats.assignedTo, userId))
    else if (opts.assignedTo) conds.push(eq(schema.chats.assignedTo, opts.assignedTo))

    if (opts.clientStatus) conds.push(eq(schema.chatResults.clientStatus, opts.clientStatus))
    if (opts.dateFrom) conds.push(sql`${schema.chatResults.updatedAt} >= ${new Date(opts.dateFrom)}`)
    if (opts.dateTo) conds.push(sql`${schema.chatResults.updatedAt} <= ${new Date(opts.dateTo)}`)

    const q = opts.q?.trim()
    if (q) {
      const like = `%${q}%`
      conds.push(or(
        ilike(schema.chatResults.flight, like),
        ilike(schema.chatResults.dates, like),
        ilike(schema.chatResults.comment, like),
        sql`${schema.chatResults.amount}::text ILIKE ${like}`,
      ))
    }

    const rows = await this.db
      .select({
        chatId: schema.chats.id,
        status: schema.chats.status,
        clientFirstName: schema.clients.firstName,
        clientLastName: schema.clients.lastName,
        clientUsername: schema.clients.username,
        clientTelegramId: schema.clients.telegramId,
        clientStatus: schema.chatResults.clientStatus,
        flight: schema.chatResults.flight,
        dates: schema.chatResults.dates,
        amount: schema.chatResults.amount,
        comment: schema.chatResults.comment,
        closedAt: schema.chatResults.updatedAt,
        managerId: schema.users.id,
        managerName: schema.users.firstName,
      })
      .from(schema.chatResults)
      .innerJoin(schema.chats, eq(schema.chats.id, schema.chatResults.chatId))
      .innerJoin(schema.clients, eq(schema.clients.id, schema.chats.clientId))
      .leftJoin(schema.users, eq(schema.users.id, schema.chats.assignedTo))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.chatResults.updatedAt))
      .limit(limit)

    return rows.map((r) => ({
      chatId: r.chatId,
      status: r.status,
      client: {
        firstName: r.clientFirstName,
        lastName: r.clientLastName,
        username: r.clientUsername,
        telegramId: r.clientTelegramId,
      },
      manager: r.managerId ? { id: r.managerId, firstName: r.managerName } : null,
      clientStatus: r.clientStatus,
      flight: r.flight,
      dates: r.dates,
      amount: r.amount,
      comment: r.comment,
      closedAt: r.closedAt,
    }))
  }

  /**
   * Ask tg-worker for a fresh TDLib profile snapshot for a given telegram user.
   * Used when the API knows the cached row is incomplete (e.g. phone is null
   * because the client only just un-hid their number). Writes through any new
   * fields (currently just phone — name updates are still gated by contacts).
   * Short budget so it never noticeably delays a chat open.
   */
  async refreshClientFromTg(telegramId: number, username?: string): Promise<TgClientRefreshResponse | null> {
    const job = await this.clientRefreshQueue.add('refresh', { telegramId, username }, {
      removeOnComplete: 100,
      removeOnFail: 50,
    })
    let snap: TgClientRefreshResponse
    try {
      // Worker does openChat + searchPublicChat + 800ms settle + getUser, so
      // the budget here is generous enough to cover queue + IPC + slow TDLib.
      snap = (await job.waitUntilFinished(this.clientRefreshEvents, 6_000)) as TgClientRefreshResponse
    } catch {
      return null    // timeout / worker down — silently degrade
    }
    // Phone and TG-contact flag both get refreshed here. Phone only ever
    // moves forward (COALESCE keeps what we knew); is_contact moves both ways
    // — user can add or delete the contact in their TG client.
    if (snap.phone || snap.isContact !== undefined) {
      await this.db
        .update(schema.clients)
        .set({
          ...(snap.phone ? { phone: sql`COALESCE(clients.phone, ${snap.phone})` } : {}),
          ...(snap.isContact !== undefined ? { inTelegramContacts: snap.isContact } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.clients.telegramId, telegramId))
    }
    return snap
  }

  /**
   * Pin or unpin a message in the client's TG chat (visible to the client too).
   * Server-side translation: chat uuid → telegram chat id, message uuid →
   * telegram message id, then enqueue. Errors bubble up so the API returns 4xx
   * when the chat/message isn't ours.
   */
  async pinMessage(chatId: string, messageId: string, pin: boolean) {
    const message = await this.db.query.messages.findFirst({
      where: (m, { eq }) => eq(m.id, messageId),
      with: { chat: { with: { client: true } } },
    })
    if (!message || message.chatId !== chatId) {
      throw new NotFoundException('Message not found')
    }
    if (!message.telegramMessageId) {
      throw new BadRequestException('Message has no Telegram id yet')
    }

    // Capture array contents BEFORE the optimistic update so the system-note
    // insertion below knows whether this was truly a new pin (and so the
    // TDLib echo handler can skip its own insert — without this snapshot
    // both paths would either both insert or both skip, depending on race).
    const beforeRow = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      columns: { pinnedMessageIds: true },
    })
    const wasPinned = beforeRow?.pinnedMessageIds.includes(messageId) ?? false

    await this.pinQueue.add('pin', {
      chatId: message.chat.client.telegramId,
      messageId: message.telegramMessageId,
      pin,
    })

    // Append (or remove) the pin in the chat's stack, latest at the end.
    // Telegram allows several pinned messages per chat — we mirror that so
    // the banner can scroll through all of them. Atomic SQL avoids a
    // read-modify-write race with concurrent pin clicks.
    const updated = await this.db
      .update(schema.chats)
      .set({
        pinnedMessageIds: pin
          ? sql`(SELECT ARRAY(SELECT DISTINCT unnest(${schema.chats.pinnedMessageIds} || ARRAY[${messageId}::uuid])))`
          : sql`array_remove(${schema.chats.pinnedMessageIds}, ${messageId}::uuid)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.chats.id, chatId))
      .returning({ pinnedMessageIds: schema.chats.pinnedMessageIds })
    const pinnedMessageIds = updated[0]?.pinnedMessageIds ?? []
    const pinnedMessages = await this.hydratePinnedMessages(pinnedMessageIds)

    // Telegram drops a "X закрепил сообщение" service note at the bottom of
    // the chat on each fresh pin (not unpin). Insert it from here for
    // CRM-initiated pins — applyExternalPin will recognise the array no
    // longer changes on its echo and skip its own insert.
    if (pin && !wasPinned) {
      const [sysMsg] = await this.db.insert(schema.messages).values({
        chatId,
        telegramMessageId: Date.now(),   // synthetic — never collides with real TG ids
        senderType: 'system',
        senderId: null,
        contentType: 'text',
        content: { type: 'text', text: pinNotePreview(message.content) },
        isRead: true,
        status: 'sent',
        createdAt: new Date(),
      }).returning()
      if (sysMsg) {
        this.gateway?.emitNewMessage(chatId, { ...sysMsg, client: message.chat.client })
      }
    }

    this.gateway?.emitChatUpdated({
      id: chatId,
      pinnedMessageIds,
      pinnedMessages,
    } as any)
    return { queued: true, pinnedMessageIds }
  }

  /** Fetch the message rows for a pin id array and return them sorted by
   *  message date, NEWEST first. The pin banner reads index 0 as "today's
   *  pin" and walks down toward older messages — sorting here keeps the
   *  frontend's banner step logic dead simple. */
  private async hydratePinnedMessages(ids: string[]) {
    if (ids.length === 0) return []
    const rows = await this.db.query.messages.findMany({
      where: (m, { inArray }) => inArray(m.id, ids),
    })
    return rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((m) => this.normalizeForwardedFrom(m))
  }

  /**
   * Forward a CRM message into any Telegram chat we can reach. The target id
   * is the TG chat id (positive for users, negative for groups/channels). If
   * the destination matches a known CRM client, processIncomingEvent will
   * pick up the echo and reflect it in the right CRM chat naturally.
   */
  async forwardMessageToTg(chatId: string, messageId: string, toTgChatId: number) {
    const message = await this.db.query.messages.findFirst({
      where: (m, { eq }) => eq(m.id, messageId),
      with: { chat: { with: { client: true } } },
    })
    if (!message || message.chatId !== chatId) {
      throw new NotFoundException('Message not found')
    }
    if (!message.telegramMessageId) {
      throw new BadRequestException('Message has no Telegram id yet')
    }
    await this.forwardQueue.add('forward', {
      fromChatId: message.chat.client.telegramId,
      messageIds: [message.telegramMessageId],
      toChatId: toTgChatId,
    })
    return { queued: true }
  }

  /**
   * Search TG chats by free text. Powers the forward picker. Short budget so
   * a slow remote search doesn't hang the dialog.
   */
  async searchTgChats(q: string, limit = 20): Promise<TgChatSearchResponse> {
    const job = await this.chatSearchQueue.add('search', { q, limit }, {
      removeOnComplete: 50,
      removeOnFail: 25,
    })
    try {
      return (await job.waitUntilFinished(this.chatSearchEvents, 5_000)) as TgChatSearchResponse
    } catch {
      return { items: [] }
    }
  }

  async findOne(chatId: string) {
    let chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: {
        client: true,
        assignedUser: { columns: { id: true, firstName: true, username: true } },
      },
    })
    if (!chat) return null

    // First time this chat is opened → backfill the prior Telegram conversation
    // so the manager sees the full history, not just messages received in the CRM.
    if (!chat.historySyncedAt) {
      await this.syncHistory(chatId, 0, 100).catch((e) =>
        console.error('[api] open-sync history failed:', e?.message),
      )
    }

    // Always ask the worker for a fresh TDLib snapshot — phone and is_contact
    // can both change between messages and we want the sidebar to reflect
    // reality. Short budget so it never holds the open noticeably; on timeout
    // we just render the cached state.
    const fresh = await this.refreshClientFromTg(
      chat.client.telegramId,
      chat.client.username ?? undefined,
    ).catch(() => null)
    if (fresh) {
      chat = {
        ...chat,
        client: {
          ...chat.client,
          phone: fresh.phone ?? chat.client.phone,
          inTelegramContacts: fresh.isContact ?? chat.client.inTelegramContacts,
        },
      }
    }

    // CRM-side "saved contact" row → drives the @nick hiding (we have a
    // team-chosen name now). TG-side flag is separate and drives the button.
    const contactRow = await this.db.query.contacts.findFirst({
      where: (c, { eq }) => eq(c.clientId, chat.client.id),
      columns: { id: true },
    })
    const hasCrmContact = !!contactRow

    // Fetch the 50 MOST RECENT messages, then reverse to chronological order
    // (oldest at top, newest at bottom — typical chat display).
    const recent = await this.db.query.messages.findMany({
      where: (m, { eq }) => eq(m.chatId, chatId),
      orderBy: (m, { desc }) => desc(m.createdAt),
      limit: 50,
    })

    // Hydrate every pinned message (Telegram allows several per chat). Goes
    // through `hydratePinnedMessages` so the banner gets them sorted by
    // message date — identical to what `pinMessage` / `applyExternalPin`
    // emit via WS, so cursor positions stay consistent across reloads.
    const pinnedMessages = await this.hydratePinnedMessages(chat.pinnedMessageIds)

    return {
      ...chat,
      hasCrmContact,
      inTelegramContacts: chat.client.inTelegramContacts ?? false,
      pinnedMessages,
      messages: recent.reverse().map((m) => this.normalizeForwardedFrom(m)),
    }
  }

  async getMessages(chatId: string, before?: string) {
    const rows = await this.db.query.messages.findMany({
      where: before
        ? (m, { eq, lt, and }) => and(eq(m.chatId, chatId), eq(m.isDeleted, false), lt(m.createdAt, new Date(before)))
        : (m, { eq, and }) => and(eq(m.chatId, chatId), eq(m.isDeleted, false)),
      orderBy: (m, { desc }) => desc(m.createdAt),
      limit: 50,
    })
    return rows.map((m) => this.normalizeForwardedFrom(m))
  }

  /** Convert the DB row's `{ name, date(unix) }` forward snapshot into the
   *  `{ name, sentAt(ISO) }` shape MessageBubble expects, so it lines up with
   *  the Favorites-side composable. */
  private normalizeForwardedFrom<T extends { forwardedFrom?: { name: string; date: number } | null }>(msg: T): T {
    if (!msg.forwardedFrom) return msg
    return {
      ...msg,
      forwardedFrom: {
        name: msg.forwardedFrom.name,
        sentAt: new Date(msg.forwardedFrom.date * 1000).toISOString(),
      },
    } as unknown as T
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
      result = await job.waitUntilFinished(this.historyEvents, 25_000)
    } catch (e) {
      throw new Error(`History sync timed out or failed: ${(e as Error).message}`)
    }

    // Mark a full (latest) sync done so we don't refetch on every open — but only
    // AFTER a successful insert below. An empty result is also "done" (no prior
    // history). Insert errors throw before the flag is set → retried next open.
    const markSynced = async () => {
      if (beforeTgId !== 0) return
      await this.db.update(schema.chats)
        .set({ historySyncedAt: new Date() })
        .where(eq(schema.chats.id, chatId)).catch(() => {})
    }

    if (result.messages.length === 0) {
      await markSynced()
      return []
    }

    const rows = result.messages.map((m) => ({
      chatId: chat.id,
      telegramMessageId: m.messageId,
      senderType: (m.isOutgoing ? 'manager' : 'client') as 'manager' | 'client',
      contentType: this.toContentType(m.content.type),
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

    await markSynced()

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

    // The chat becomes 'new' so the recipient (or queue) sees it as fresh.
    // On reassign the owner is the target; on queue-return the owner is cleared.
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

    // Returning to the queue → try to hand it to another idle employee
    // (excluding the person who just released it, so it doesn't bounce back).
    // If nobody else is free, it stays in the queue until someone closes or
    // comes online.
    let recipientId: string | null = toUserId
    let autoAssigned = false
    if (!toUserId) {
      const auto = await this.pickAssignee(actorId)
      if (auto) {
        recipientId = auto
        autoAssigned = true
        await this.autoAssignChat(chatId, auto, 'auto_distribute_on_return')
      }
    }

    // System note in the timeline — the recipient sees the comment in context.
    const fromUser = fromUserId
      ? await this.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, fromUserId), columns: { firstName: true } })
      : null
    const fromName = fromUser?.firstName ?? null
    const text = toUserId
      ? `🔄 Чат передан${fromName ? ` от ${fromName}` : ''}: ${note}`
      : autoAssigned
        ? `↩️ Чат возвращён в очередь${fromName ? ` (${fromName})` : ''} и передан другому сотруднику: ${note}`
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

    // Notify whoever ended up with the chat (direct recipient or auto-assigned).
    if (recipientId) {
      const clientName = [chat.client.firstName, chat.client.lastName].filter(Boolean).join(' ') || 'Клиент'
      const title = `Вам передали чат: ${clientName}`
      this.notifications?.sendToUser(recipientId, { title, body: note, chatId, tag: chatId, force: true }).catch(() => {})
      // In-app notification (center + toast) — reliable regardless of OS push.
      this.gateway?.emitToUsers([recipientId], 'notify', { type: 'transfer', title, body: note, chatId })
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
    status: string
    flightFrom?: string
    flightTo?: string
    dates?: string
    amount?: number
    comment?: string
  }) {
    if (result) {
      // Validate against admin-managed close_reasons; reject unknown keys so we
      // never persist a status that the Results page can't render a label for.
      const ok = await this.closeReasons.exists(result.status)
      if (!ok) throw new BadRequestException('Неизвестный статус закрытия чата')

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

    // Closing a chat frees the closer's "one active slot" — hand them the
    // next queued chat right away (round-robin will naturally pick them since
    // they're now the only idle online user, or the longest-idle one).
    this.distributeQueuedChats().catch((e) =>
      console.error('[api] distribute after close failed:', e),
    )

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
    // Stamp the first manager reply so reports can measure response time.
    const firstResponse = chat.firstResponseAt == null ? { firstResponseAt: message.createdAt } : {}
    await this.db
      .update(schema.chats)
      .set({ ...statusUpdate, ...ownerUpdate, ...firstResponse, lastMessageAt: message.createdAt, updatedAt: new Date() })
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
    const firstResponse = chat.firstResponseAt == null ? { firstResponseAt: new Date() } : {}
    await this.db
      .update(schema.chats)
      .set({ ...statusUpdate, ...ownerUpdate, ...firstResponse, lastMessageAt: new Date(), updatedAt: new Date() })
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

  /**
   * Reflect a pin/unpin done outside the CRM (or echoed from our own pin) in
   * the chats.pinned_message_ids array. Idempotent — the same event arriving
   * twice is fine. Emits chat:updated so connected managers see the banner
   * flip without a refetch.
   */
  async applyExternalPin(event: TgMessagePinnedEvent) {
    const message = await this.db.query.messages.findFirst({
      where: (m, { eq, and }) => and(
        eq(m.telegramMessageId, event.messageId),
        eq(m.chatId, sql`(SELECT id FROM chats WHERE client_id = (SELECT id FROM clients WHERE telegram_id = ${event.chatId}))`),
      ),
      columns: { id: true, chatId: true, content: true },
    })
    if (!message) return    // we don't have this msg yet — re-syncs will catch it

    // Snapshot the array before/after to tell apart "truly changed" (TDLib
    // first echo) from "already known" (idempotent replay) — only the first
    // should drop a system note at the bottom of the chat.
    const before = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, message.chatId),
      columns: { pinnedMessageIds: true, clientId: true },
    })
    if (!before) return

    const updated = await this.db
      .update(schema.chats)
      .set({
        pinnedMessageIds: event.isPinned
          ? sql`(SELECT ARRAY(SELECT DISTINCT unnest(${schema.chats.pinnedMessageIds} || ARRAY[${message.id}::uuid])))`
          : sql`array_remove(${schema.chats.pinnedMessageIds}, ${message.id}::uuid)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.chats.id, message.chatId))
      .returning({ pinnedMessageIds: schema.chats.pinnedMessageIds })

    const after = updated[0]?.pinnedMessageIds ?? []
    const wasPinned = before.pinnedMessageIds.includes(message.id)
    const isPinned = after.includes(message.id)

    // Drop a service note only when the pin truly transitioned from "not
    // pinned" → "pinned" in our array. CRM-initiated pins handle the note in
    // pinMessage and have already filled the array before this echo arrives,
    // so wasPinned will be true here and we'll correctly skip. Same goes for
    // any double-fire of the TDLib echo itself.
    if (event.isPinned && !wasPinned && isPinned) {
      const text = pinNotePreview(message.content)
      const [sysMsg] = await this.db.insert(schema.messages).values({
        chatId: message.chatId,
        telegramMessageId: Date.now(),     // synthetic — never collides with real TG ids
        senderType: 'system',
        senderId: null,
        contentType: 'text',
        content: { type: 'text', text },
        isRead: true,
        status: 'sent',
        createdAt: new Date(),
      }).returning()

      const client = await this.db.query.clients.findFirst({
        where: (c, { eq }) => eq(c.id, before.clientId),
      })
      if (sysMsg) {
        this.gateway?.emitNewMessage(message.chatId, { ...sysMsg, client })
      }
    }

    this.gateway?.emitChatUpdated({
      id: message.chatId,
      pinnedMessageIds: after,
      pinnedMessages: await this.hydratePinnedMessages(after),
    } as any)
  }

}
