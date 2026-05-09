import { Redis } from 'ioredis'
import { config } from './config.js'

export const redis = new Redis(config.redis.url, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
})

redis.on('connect', () => console.log('[tg-worker] redis connected'))
redis.on('error', (err: Error) => console.error('[tg-worker] redis error:', err.message))
redis.on('close', () => console.log('[tg-worker] redis disconnected'))

export async function connectRedis() {
  await redis.connect()
}
