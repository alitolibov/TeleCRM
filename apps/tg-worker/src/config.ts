import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing env variable: ${name}. Check your .env file at repo root.`)
  }
  return value
}

export const config = {
  tg: {
    apiId: Number(required('TG_API_ID')),
    apiHash: required('TG_API_HASH'),
    phoneNumber: required('TG_PHONE_NUMBER'),
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  paths: {
    tdlibDb: path.join(ROOT, 'data/tdlib/db'),
    tdlibFiles: path.join(ROOT, 'data/tdlib/files'),
  },
}
