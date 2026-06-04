import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { desc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { REDIS_QUEUES } from '@telecrm/shared'
import type { TgAddContactJob } from '@telecrm/shared'
import { DRIZZLE } from '../db/drizzle.module'
import * as schema from '../db/schema'
import type { UpsertContactDto } from './dto/contact.dto'

/**
 * Saved contacts — a chat's client promoted to a named contact.
 *
 * Adding a contact:
 *  1. upserts the `contacts` row (unique on client_id),
 *  2. writes the override name through to `clients.firstName/lastName`
 *     so chat list / header / search reflect it immediately,
 *  3. fires a best-effort `addContact` to TDLib (worker side) when we have a
 *     phone — otherwise the contact is CRM-only.
 *
 * Global visibility: everyone sees everyone's additions.
 */
@Injectable()
export class ContactsService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @InjectQueue(REDIS_QUEUES.tgAddContact) private addContactQueue: Queue<TgAddContactJob>,
  ) {}

  /** Upsert: re-adding the same client with new names just updates the row. */
  async upsert(userId: string, dto: UpsertContactDto) {
    const chat = await this.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.id, dto.chatId),
      with: { client: true },
    })
    if (!chat) throw new NotFoundException('Chat not found')

    const firstName = dto.firstName.trim()
    const lastName = dto.lastName?.trim() || null
    // DTO phone wins over the stored value — the employee just typed it,
    // they know better than our stale TDLib snapshot. Normalise lightly:
    // strip spaces/dashes/brackets, keep the leading +.
    const phone = dto.phone
      ? dto.phone.replace(/[^\d+]/g, '').replace(/^00/, '+')
      : chat.client.phone ?? null
    const now = new Date()

    const [contact] = await this.db
      .insert(schema.contacts)
      .values({
        clientId: chat.client.id,
        addedBy: userId,
        firstName,
        lastName,
      })
      .onConflictDoUpdate({
        target: schema.contacts.clientId,
        set: { firstName, lastName, updatedAt: now },
      })
      .returning()

    // Write-through so every existing query that reads client.firstName /
    // client.lastName (chat list, header, search) picks up the override
    // without needing to learn about the contacts table. Phone gets the same
    // treatment so the sidebar updates immediately. When we have a phone we
    // also pre-flip the TG-contact flag — the addContact job will follow up
    // and make it true on the actual Telegram side, but the UI flips now so
    // the button switches to "В контактах" without waiting for a round-trip.
    await this.db
      .update(schema.clients)
      .set({
        firstName,
        lastName,
        phone,
        ...(phone ? { inTelegramContacts: true } : {}),
        updatedAt: now,
      })
      .where(eq(schema.clients.id, chat.client.id))

    // Best-effort TG side: only when we actually have a phone number now.
    if (phone) {
      await this.addContactQueue.add('add', {
        userId: chat.client.telegramId,
        phoneNumber: phone,
        firstName,
        lastName: lastName ?? '',
      })
    }

    return contact
  }

  /**
   * Global list, newest-first. Joined with `clients` and `users` for the row
   * card; a correlated subquery resolves the most recent chat id so each row
   * can deep-link into a conversation.
   */
  async list() {
    return this.db
      .select({
        id: schema.contacts.id,
        firstName: schema.contacts.firstName,
        lastName: schema.contacts.lastName,
        addedAt: schema.contacts.addedAt,
        // Most recent chat per client → used by the page to deep-link.
        chatId: sql<string | null>`(
          SELECT id FROM chats
          WHERE chats.client_id = ${schema.clients.id}
          ORDER BY chats.created_at DESC
          LIMIT 1
        )`,
        client: {
          id: schema.clients.id,
          telegramId: schema.clients.telegramId,
          username: schema.clients.username,
          phone: schema.clients.phone,
        },
        addedBy: {
          id: schema.users.id,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
        },
      })
      .from(schema.contacts)
      .innerJoin(schema.clients, eq(schema.contacts.clientId, schema.clients.id))
      .innerJoin(schema.users, eq(schema.contacts.addedBy, schema.users.id))
      .orderBy(desc(schema.contacts.addedAt))
  }

  /** Quick existence check for the "Add to contacts" button state. */
  async findByClient(clientId: string) {
    return this.db.query.contacts.findFirst({
      where: (c, { eq }) => eq(c.clientId, clientId),
    })
  }
}
