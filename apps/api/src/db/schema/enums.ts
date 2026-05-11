import { pgEnum } from 'drizzle-orm/pg-core'

export const userRole = pgEnum('user_role', ['admin', 'manager'])
export const userStatus = pgEnum('user_status', ['online', 'offline'])
export const chatStatus = pgEnum('chat_status', ['new', 'active', 'closed'])
export const senderType = pgEnum('sender_type', ['client', 'manager', 'system'])
export const contentType = pgEnum('content_type', [
  'text', 'photo', 'video', 'voice', 'document', 'sticker', 'unsupported',
])
export const messageStatus = pgEnum('message_status', ['sending', 'sent', 'failed'])
export const clientStatus = pgEnum('client_status', [
  'thinking', 'consulting', 'waiting_price', 'booked', 'bought',
])
export const actionType = pgEnum('action_type', [
  'chat_assigned', 'chat_transferred', 'chat_status_changed',
  'user_login', 'user_logout', 'user_status_changed',
  'user_created', 'user_deleted',
])
