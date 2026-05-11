import { relations } from 'drizzle-orm'
import { users } from './users'
import { sessions } from './sessions'
import { chats } from './chats'
import { messages } from './messages'
import { chatResults } from './chat-results'
import { chatTransfers } from './chat-transfers'
import { quickReplies } from './quick-replies'
import { actionLogs } from './action-logs'
import { pushSubscriptions } from './push-subscriptions'
import { clients } from './clients'

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  chats: many(chats),
  quickReplies: many(quickReplies),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const clientsRelations = relations(clients, ({ many }) => ({
  chats: many(chats),
}))

export const chatsRelations = relations(chats, ({ one, many }) => ({
  client: one(clients, { fields: [chats.clientId], references: [clients.id] }),
  assignedUser: one(users, { fields: [chats.assignedTo], references: [users.id] }),
  messages: many(messages),
  result: one(chatResults),
  transfers: many(chatTransfers),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}))

export const chatResultsRelations = relations(chatResults, ({ one }) => ({
  chat: one(chats, { fields: [chatResults.chatId], references: [chats.id] }),
  createdByUser: one(users, { fields: [chatResults.createdBy], references: [users.id] }),
}))

export const chatTransfersRelations = relations(chatTransfers, ({ one }) => ({
  chat: one(chats, { fields: [chatTransfers.chatId], references: [chats.id] }),
  fromUser: one(users, { fields: [chatTransfers.fromUserId], references: [users.id] }),
  toUser: one(users, { fields: [chatTransfers.toUserId], references: [users.id] }),
}))

export const quickRepliesRelations = relations(quickReplies, ({ one }) => ({
  user: one(users, { fields: [quickReplies.userId], references: [users.id] }),
}))

export const actionLogsRelations = relations(actionLogs, ({ one }) => ({
  actor: one(users, { fields: [actionLogs.actorId], references: [users.id] }),
  chat: one(chats, { fields: [actionLogs.chatId], references: [chats.id] }),
}))

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.userId], references: [users.id] }),
}))
