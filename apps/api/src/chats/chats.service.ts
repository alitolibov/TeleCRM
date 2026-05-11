import { Inject, Injectable, Optional } from '@nestjs/common'
import { Queue } from 'bullmq'
import { InjectQueue } from '@nestjs/bullmq'
import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { TgIncomingEvent, TgOutgoingJob } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import type { ChatsGateway } from './chats.gateway'

@Injectable()
export class ChatsService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @InjectQueue(REDIS_QUEUES.tgOutgoing) private outgoingQueue: Queue<TgOutgoingJob>,
    @Optional() private gateway: ChatsGateway,
  ) {}

  async processIncomingEvent(event: TgIncomingEvent) {
    // 1. Upsert client
    const [client] = await this.db
      .insert(schema.clients)
      .values({
        telegramId: event.senderId,
        firstName: event.senderFirstName,
        lastName: event.senderLastName ?? null,
        username: event.senderUsername ?? null,
      })
      .onConflictDoUpdate({
        target: schema.clients.telegramId,
        set: {
          firstName: event.senderFirstName,
          lastName: event.senderLastName ?? null,
          username: event.senderUsername ?? null,
          updatedAt: new Date(),
        },
      })
      .returning()

    // 2. Find existing chat (any status) or create new one
    let chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.clientId, client.id),
      orderBy: (c, { desc }) => desc(c.createdAt),
    })

    if (!chat) {
      const [newChat] = await this.db
        .insert(schema.chats)
        .values({ clientId: client.id, status: 'new' })
        .returning()
      chat = newChat
    } else if (chat.status === 'closed') {
      const [reopened] = await this.db
        .update(schema.chats)
        .set({ status: 'new', closedAt: null, updatedAt: new Date() })
        .where(eq(schema.chats.id, chat.id))
        .returning()
      chat = reopened
    }

    // 3. Insert message (ON CONFLICT DO NOTHING — dedup by telegramMessageId)
    const contentType = event.content.type as schema.ContentType
    const isNewChat = !chat.lastMessageAt
    const [message] = await this.db
      .insert(schema.messages)
      .values({
        chatId: chat.id,
        telegramMessageId: event.messageId,
        senderType: 'client',
        contentType,
        content: event.content,
        isRead: false,
        status: 'sent',
        createdAt: new Date(event.date * 1000),
      })
      .onConflictDoNothing()
      .returning()

    if (!message) return // duplicate — already processed

    // 4. Update chat stats
    await this.db
      .update(schema.chats)
      .set({
        unreadCount: sql`${schema.chats.unreadCount} + 1`,
        lastMessageAt: message.createdAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.chats.id, chat.id))

    // 5. Realtime push
    this.gateway?.emitNewMessage(chat.id, { ...message, client })
    if (isNewChat) {
      this.gateway?.emitNewChat({ ...chat, client })
    } else {
      this.gateway?.emitChatUpdated({ id: chat.id, unreadCount: chat.unreadCount + 1, lastMessageAt: message.createdAt })
    }

    return { client, chat, message }
  }

  async findAll(userId: string, role: string) {
    return this.db.query.chats.findMany({
      where: role === 'manager'
        ? (c, { eq }) => eq(c.assignedTo, userId)
        : undefined,
      with: {
        client: true,
        assignedUser: { columns: { id: true, firstName: true, username: true } },
      },
      orderBy: (c, { desc }) => desc(c.lastMessageAt),
    })
  }

  async findOne(chatId: string) {
    return this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, chatId),
      with: {
        client: true,
        assignedUser: { columns: { id: true, firstName: true, username: true } },
        messages: {
          orderBy: (m, { asc }) => asc(m.createdAt),
          limit: 50,
        },
      },
    })
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

  async assign(chatId: string, userId: string) {
    const [chat] = await this.db
      .update(schema.chats)
      .set({ assignedTo: userId, status: 'active', updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))
      .returning()
    return chat
  }

  async close(chatId: string) {
    const [chat] = await this.db
      .update(schema.chats)
      .set({ status: 'closed', closedAt: new Date(), unreadCount: 0, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))
      .returning()
    return chat
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
        status: 'sent',
        createdAt: new Date(),
      })
      .returning()

    await this.db
      .update(schema.chats)
      .set({ lastMessageAt: message.createdAt, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))

    return message
  }

  async markRead(chatId: string) {
    await this.db
      .update(schema.chats)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(eq(schema.chats.id, chatId))

    await this.db
      .update(schema.messages)
      .set({ isRead: true })
      .where(and(eq(schema.messages.chatId, chatId), eq(schema.messages.isRead, false)))
  }
}
