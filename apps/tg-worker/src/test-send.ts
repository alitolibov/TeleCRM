import { Queue } from 'bullmq'
import type { TgOutgoingJob } from '@telecrm/shared'
import { REDIS_QUEUES } from '@telecrm/shared'

const chatId = Number(process.argv[2])
const text = process.argv.slice(3).join(' ') || 'Test message from TeleCRM'

if (!chatId) {
  console.error('Usage: tsx src/test-send.ts <chatId> [text]')
  process.exit(1)
}

const queue = new Queue<TgOutgoingJob>(REDIS_QUEUES.tgOutgoing, {
  connection: { host: 'localhost', port: 6379 },
})

await queue.add('send', { chatId, content: { type: 'text', text } })
console.log(`✓ Queued message to chat ${chatId}: "${text}"`)

await queue.close()
