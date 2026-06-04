import { Worker } from 'bullmq'
import type { TgAddContactJob, TgClientRefreshRequest, TgClientRefreshResponse } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'
import { config } from './config.js'
import { toClientSnapshot } from './messages.js'

function buildRedisConnection() {
  const url = new URL(config.redis.url)
  return { host: url.hostname, port: Number(url.port) || 6379 }
}

/**
 * Promotes a chat's client to a Telegram-side contact. Best-effort: a missing
 * phone or a transient TDLib error is logged but doesn't break the CRM-side
 * contact, which is already saved by the time this job runs.
 */
export function setupContactsWorker(client: any) {
  const worker = new Worker<TgAddContactJob>(
    REDIS_QUEUES.tgAddContact,
    async (job) => {
      const { userId, phoneNumber, firstName, lastName } = job.data
      if (!phoneNumber) {
        console.log(`[tg-worker] skip addContact user=${userId} — no phone`)
        return
      }
      await client.invoke({
        _: 'addContact',
        contact: {
          _: 'contact',
          phone_number: phoneNumber,
          first_name: firstName,
          last_name: lastName,
          user_id: userId,        // already-known TG user id — speeds up the lookup
        },
        share_phone_number: false,
      })
    },
    { connection: buildRedisConnection(), concurrency: 2 },
  )

  worker.on('completed', (job) =>
    console.log(`[tg-worker] ✓ contact added user=${job.data.userId}`),
  )
  worker.on('failed', (job, err) =>
    console.error(`[tg-worker] addContact failed (user ${job?.data.userId}):`, err.message),
  )

  // Refresh a client's profile on demand — used by the API to backfill the
  // phone (and other fields) on chats that pre-date the current TDLib session
  // or pre-date the phone-aware upsert.
  //
  // TDLib's local `getUser` returns whatever cached snapshot it has, which
  // is stale when the client changes their phone-visibility setting AFTER
  // we first met them. To force a server round-trip we call
  // `searchPublicChat` (when we know the username) — that fetches a fresh
  // User object and the server pushes updateUser with the up-to-date phone.
  // `getChat` is a softer nudge that helps when there's no username.
  const refresh = new Worker<TgClientRefreshRequest, TgClientRefreshResponse>(
    REDIS_QUEUES.tgClientRefresh,
    async (job) => {
      const { telegramId, username } = job.data
      // Three nudges to make TDLib fetch fresh privacy-gated fields:
      //  1. openChat — subscribes us to updateUser pushes for this user.
      //  2. searchPublicChat — server round-trip via username (if any).
      //  3. getUserFullInfo — forces a profile fetch (bio, settings…) which
      //     side-effects a fresh updateUser when TDLib has new data.
      // Then we wait for updateUser to be digested before reading.
      await client.invoke({ _: 'openChat', chat_id: telegramId }).catch(() => {})
      if (username) {
        await client.invoke({ _: 'searchPublicChat', username }).catch(() => {})
      }
      await client.invoke({ _: 'getUserFullInfo', user_id: telegramId }).catch(() => {})
      await new Promise((r) => setTimeout(r, 1000))
      const user = await client.invoke({ _: 'getUser', user_id: telegramId })
        .catch(() => null)
      await client.invoke({ _: 'closeChat', chat_id: telegramId }).catch(() => {})
      if (!user) return {}
      const snap = toClientSnapshot(user, telegramId)
      console.log(
        `[tg-worker] refresh user=${telegramId} phone=${snap.phone ?? '<none>'} ` +
        `isContact=${snap.isContact} raw="${user.phone_number ?? ''}" ` +
        `(${username ? '@' + username : 'no username'})`,
      )
      return {
        firstName: snap.firstName,
        lastName: snap.lastName,
        username: snap.username,
        phone: snap.phone,
        isContact: snap.isContact,
      }
    },
    { connection: buildRedisConnection(), concurrency: 4 },
  )
  refresh.on('failed', (job, err) =>
    console.error(`[tg-worker] refresh failed (user ${job?.data.telegramId}):`, err.message),
  )

  return { worker, refresh }
}
