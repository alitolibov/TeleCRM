import { Inject, Injectable, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Queue, QueueEvents } from 'bullmq'
import { InjectQueue } from '@nestjs/bullmq'
import { ConfigService } from '@nestjs/config'
import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type {
  TgMessageEvent,
  TgOutgoingJob,
  TgHistoryRequestJob,
  TgHistoryResponse,
  TgReadSyncEvent,
} from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import { ChatsGateway } from './chats.gateway'

@Injectable()
export class ChatsService implements OnModuleInit, OnModuleDestroy {
  private historyEvents!: QueueEvents

  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @InjectQueue(REDIS_QUEUES.tgOutgoing) private outgoingQueue: Queue<TgOutgoingJob>,
    @InjectQueue(REDIS_QUEUES.tgHistoryRequest) private historyQueue: Queue<TgHistoryRequestJob, TgHistoryResponse>,
    private configService: ConfigService,
    @Optional() private gateway: ChatsGateway,
  ) {}

  async onModuleInit() {
    const url = new URL(this.configService.get('REDIS_URL', 'redis://localhost:6379'))
    this.historyEvents = new QueueEvents(REDIS_QUEUES.tgHistoryRequest, {
      connection: { host: url.hostname, port: Number(url.port) || 6379 },
    })
  }

  async onModuleDestroy() {
    await this.historyEvents?.close().catch(() => {})
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
      // regardless of direction. Avoids the "take in work?" modal for chats
      // that already had a back-and-forth.
      const [reopened] = await this.db
        .update(schema.chats)
        .set({ status: 'active', closedAt: null, updatedAt: new Date() })
        .where(eq(schema.chats.id, chat.id))
        .returning()
      chat = reopened
    } else if (chat.status === 'new' && event.isOutgoing) {
      // Manager replied to a still-untouched chat (e.g. from phone) — promote
      // to 'active' so it stops counting as awaiting first response.
      const [activated] = await this.db
        .update(schema.chats)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(schema.chats.id, chat.id))
        .returning()
      chat = activated
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
        return // already shown via sendMessage API response
      }
    }

    // 4. Insert message (ON CONFLICT DO NOTHING — dedup by telegramMessageId)
    const contentType = event.content.type as schema.ContentType
    const isNewChat = !chat.lastMessageAt
    const senderType = event.isOutgoing ? 'manager' : 'client'

    const [message] = await this.db
      .insert(schema.messages)
      .values({
        chatId: chat.id,
        telegramMessageId: event.messageId,
        senderType,
        contentType,
        content: event.content,
        isRead: event.isOutgoing,
        status: 'sent',
        createdAt: new Date(event.date * 1000),
      })
      .onConflictDoNothing()
      .returning()

    if (!message) return // duplicate — already processed

    // 4. Update chat stats. Only count incoming messages toward unread.
    const newUnreadCount = event.isOutgoing ? chat.unreadCount : chat.unreadCount + 1
    await this.db
      .update(schema.chats)
      .set({
        ...(event.isOutgoing ? {} : { unreadCount: sql`${schema.chats.unreadCount} + 1` }),
        lastMessageAt: message.createdAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.chats.id, chat.id))

    // 5. Realtime push — emit chat:new FIRST so the chat exists in the
    // frontend's list before message:new tries to update it.
    if (isNewChat) {
      this.gateway?.emitNewChat({
        ...chat, client,
        unreadCount: newUnreadCount,
        lastMessageAt: message.createdAt,
        lastMessage: message,
      })
    } else {
      this.gateway?.emitChatUpdated({
        id: chat.id,
        status: chat.status, // include in case it was reopened (closed→active) or upgraded (new→active)
        unreadCount: newUnreadCount,
        lastMessageAt: message.createdAt,
        lastMessage: message,
      })
    }
    this.gateway?.emitNewMessage(chat.id, { ...message, client })

    return { client, chat, message }
  }

  async findAll(userId: string, role: string) {
    const chats = await this.db.query.chats.findMany({
      where: role === 'manager'
        ? (c, { eq }) => eq(c.assignedTo, userId)
        : undefined,
      with: {
        client: true,
        assignedUser: { columns: { id: true, firstName: true, username: true } },
      },
      orderBy: (c, { desc }) => desc(c.lastMessageAt),
    })

    if (chats.length === 0) return []

    // Fetch the last message per chat in parallel for the list preview
    const lastMessages = await Promise.all(
      chats.map((chat) =>
        this.db.query.messages.findFirst({
          where: (m, { eq }) => eq(m.chatId, chat.id),
          orderBy: (m, { desc }) => desc(m.createdAt),
        }),
      ),
    )

    return chats.map((chat, i) => ({ ...chat, lastMessage: lastMessages[i] ?? null }))
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
        ? (m, { eq, lt, and }) => and(eq(m.chatId, chatId), lt(m.createdAt, new Date(before)))
        : (m, { eq }) => eq(m.chatId, chatId),
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
    const [chat] = await this.db
      .update(schema.chats)
      .set({ assignedTo: userId, status: 'active', updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))
      .returning()
    return chat
  }

  async close(chatId: string, userId: string, result?: {
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

    const [chat] = await this.db
      .update(schema.chats)
      .set({ status: 'closed', closedAt: new Date(), unreadCount: 0, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))
      .returning()

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

    const closedChatsWithResults = allChats.filter((c) => c.result)
    const latestResult = closedChatsWithResults[closedChatsWithResults.length - 1]?.result ?? null

    return {
      client: chat.client,
      assignedUser: chat.assignedUser,
      totalDialogs: allChats.length,
      firstContactAt: allChats[0]?.createdAt ?? chat.createdAt,
      latestStatus: latestResult?.clientStatus ?? null,
      currentChatResult: allChats.find((c) => c.id === chatId)?.result ?? null,
      history: closedChatsWithResults.map((c) => ({
        chatId: c.id,
        closedAt: c.closedAt,
        clientStatus: c.result!.clientStatus,
        flight: c.result!.flight,
        amount: c.result!.amount,
        dates: c.result!.dates,
      })),
    }
  }

  async sendMessage(chatId: string, text: string, senderId: string) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: { client: true },
    })
    if (!chat) throw new Error('Chat not found')

    await this.outgoingQueue.add('send', {
      chatId: chat.client.telegramId,
      content: { type: 'text', text },
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
      })
      .returning()

    // If the chat was closed and the manager replied, reopen it as 'active'
    // immediately (don't wait for the TDLib echo to update status).
    const statusUpdate = chat.status === 'closed' ? { status: 'active' as const, closedAt: null } : {}
    await this.db
      .update(schema.chats)
      .set({ ...statusUpdate, lastMessageAt: message.createdAt, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))

    // Manager engaged → mark everything before this as read (clears unread badge
    // AND sends viewMessages to Telegram so the client sees double-check).
    await this.markRead(chatId)

    // Broadcast so all open CRM clients (other managers, other tabs) see the message
    this.gateway?.emitNewMessage(chatId, { ...message, client: chat.client })
    this.gateway?.emitChatUpdated({
      id: chatId,
      ...(chat.status === 'closed' ? { status: 'active' } : {}),
      unreadCount: 0,
      lastMessageAt: message.createdAt,
      lastMessage: message,
    })

    return { ...message, status: chat.status === 'closed' ? 'active' : message.status }
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
    filePath: string,
    fileName: string,
    mimeType: string,
    _size: number,
    _senderId: string,
    caption?: string,
  ) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: { client: true },
    })
    if (!chat) throw new Error('Chat not found')

    const isImage = mimeType.startsWith('image/')
    const contentType: schema.ContentType = isImage ? 'photo' : 'document'

    // Queue the upload + send to tg-worker
    await this.outgoingQueue.add('send', {
      chatId: chat.client.telegramId,
      content: isImage
        ? { type: 'photo', filePath, caption }
        : { type: 'document', filePath, fileName, caption },
    })

    // For text we save a 'sending' placeholder; for media we wait for the TDLib
    // echo (it brings a real fileId that the /files endpoint can serve).
    // Reopen closed chats so the manager's send is reflected as "active" right away.
    const statusUpdate = chat.status === 'closed' ? { status: 'active' as const, closedAt: null } : {}
    await this.db
      .update(schema.chats)
      .set({ ...statusUpdate, lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))

    // Manager engaged → clear unread + Telegram read receipts.
    await this.markRead(chatId)

    this.gateway?.emitChatUpdated({
      id: chatId,
      ...(chat.status === 'closed' ? { status: 'active' } : {}),
      unreadCount: 0,
      lastMessageAt: new Date(),
    })

    return { queued: true, contentType, fileName }
  }
}
