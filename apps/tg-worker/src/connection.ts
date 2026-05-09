import type { TgConnectionEvent } from '@telecrm/shared'
import { REDIS_CHANNELS } from '@telecrm/shared'
import { redis } from './redis.js'

const tdlibStateMap: Record<string, TgConnectionEvent['state']> = {
  connectionStateConnecting: 'connecting',
  connectionStateConnectingToProxy: 'connecting',
  connectionStateWaitingForNetwork: 'disconnected',
  connectionStateUpdating: 'connected',
  connectionStateReady: 'connected',
}

export function setupConnectionMonitor(client: any) {
  client.on('update', async (update: any) => {
    if (update._ !== 'updateConnectionState') return

    const raw = update.state._ as string
    const state = tdlibStateMap[raw] ?? 'connecting'

    const event: TgConnectionEvent = { state, timestamp: Date.now() }
    await redis.publish(REDIS_CHANNELS.tgConnection, JSON.stringify(event))
  })
}
