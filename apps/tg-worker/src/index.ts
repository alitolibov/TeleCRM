import { APP_NAME } from '@telecrm/shared'
import { config } from './config.js'
import { createTdlibClient } from './tdlib.js'
import { loginHandlers, closeReadline } from './auth.js'
import { connectRedis, redis } from './redis.js'
import { setupMessageHandler } from './messages.js'
import { setupSender } from './sender.js'
import { setupConnectionMonitor } from './connection.js'
import { setupHistoryWorker } from './history.js'
import { setupFileWorker } from './files.js'
import { setupEditor } from './editor.js'
import { setupContactsWorker } from './contacts.js'
import { setupActionWorkers } from './actions.js'

console.log(`[tg-worker] starting ${APP_NAME}...`)

const client = createTdlibClient()

client.on('error', (err) => {
  console.error('[tg-worker] tdlib error:', err)
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[tg-worker] ${signal} — shutting down...`)
  closeReadline()
  await redis.quit().catch(() => {})
  await client.close().catch(() => {})
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

try {
  await connectRedis()
  await client.login(loginHandlers(config.tg.phoneNumber))
  closeReadline()

  const me = await client.invoke({ _: 'getMe' })
  console.log(`[tg-worker] logged in as ${me.first_name} (id: ${me.id})`)

  setupConnectionMonitor(client)
  setupMessageHandler(client, me.id)
  setupSender(client)
  setupHistoryWorker(client)
  setupFileWorker(client)
  setupEditor(client)
  setupContactsWorker(client)
  setupActionWorkers(client)

  console.log('[tg-worker] ready — listening for messages...')
} catch (err) {
  console.error('[tg-worker] fatal error:', err)
  closeReadline()
  process.exit(1)
}
