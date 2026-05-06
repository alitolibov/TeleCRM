import { APP_NAME } from '@telecrm/shared'
import { config } from './config.js'
import { createTdlibClient } from './tdlib.js'
import { loginHandlers } from './auth.js'

console.log(`[tg-worker] starting ${APP_NAME}...`)
console.log(`[tg-worker] tdlib data dir: ${config.paths.tdlibDb}`)

const client = createTdlibClient()

client.on('error', (err) => {
  console.error('[tg-worker] tdlib error:', err)
})

client.on('update', (update) => {
  if (update._ === 'updateAuthorizationState') {
    console.log('[tg-worker] auth state:', update.authorization_state._)
  }
  if (update._ === 'updateConnectionState') {
    console.log('[tg-worker] connection:', update.state._)
  }
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[tg-worker] received ${signal}, closing TDLib...`)
  try {
    await client.close()
  } catch (err) {
    console.error('[tg-worker] close error:', err)
  }
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

console.log('[tg-worker] starting login flow...')
await client.login(loginHandlers(config.tg.phoneNumber))

const me = await client.invoke({ _: 'getMe' })
console.log(`[tg-worker] logged in as ${me.first_name} (${me.id})`)
