import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'

@WebSocketGateway({
  cors: {
    origin: (process.env.WEB_URL ?? 'http://localhost:3001').split(',').map(o => o.trim()),
    credentials: true,
  },
})
export class ChatsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers.authorization?.replace('Bearer ', '')
      const payload = this.jwtService.verify(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      })
      socket.data.userId = payload.sub
      socket.data.role = payload.role
      socket.join(`user:${payload.sub}`)
      console.log(`[ws] connected user=${payload.sub} role=${payload.role}`)
    } catch (e) {
      console.warn('[ws] auth failed, disconnecting')
      socket.disconnect()
    }
  }

  handleDisconnect(socket: Socket) {
    if (socket.data.userId) console.log(`[ws] disconnected user=${socket.data.userId}`)
  }

  @SubscribeMessage('join:chat')
  handleJoinChat(@ConnectedSocket() socket: Socket, chatId: string) {
    socket.join(`chat:${chatId}`)
  }

  @SubscribeMessage('leave:chat')
  handleLeaveChat(@ConnectedSocket() socket: Socket, chatId: string) {
    socket.leave(`chat:${chatId}`)
  }

  // Broadcast — every connected manager should see new messages so chat list
  // stays in sync, not only when they've opened a specific chat.
  emitNewMessage(_chatId: string, payload: unknown) {
    const clients = this.server?.sockets?.sockets?.size ?? 0
    console.log(`[ws] emit message:new → ${clients} client(s)`)
    this.server.emit('message:new', payload)
  }

  emitChatUpdated(chat: unknown) {
    this.server.emit('chat:updated', chat)
  }

  emitNewChat(chat: unknown) {
    const clients = this.server?.sockets?.sockets?.size ?? 0
    console.log(`[ws] emit chat:new → ${clients} client(s)`)
    this.server.emit('chat:new', chat)
  }

  emitMessageEdited(_chatId: string, payload: unknown) {
    this.server.emit('message:edited', payload)
  }

  emitMessageDeleted(_chatId: string, payload: unknown) {
    this.server.emit('message:deleted', payload)
  }

  emitMessageStatus(payload: unknown) {
    this.server.emit('message:status', payload)
  }

  /** Client read our outgoing messages — frontend flips ✓ → ✓✓ on every id
   *  in the list. We emit ids rather than re-computing on the frontend so the
   *  client never has to know about telegram_message_id ordering. */
  emitOutboxRead(payload: { chatId: string; ids: string[]; readAt: string }) {
    this.server.emit('chat:outbox-read', payload)
  }

  /** Typing / recording / uploading indicator — short-lived, high-frequency.
   *  Frontend auto-clears the indicator if no fresh action arrives within a
   *  few seconds, matching Telegram's own behaviour. */
  emitChatAction(payload: { chatId: string; action: string }) {
    this.server.emit('chat:action', payload)
  }

  /** Emit an event only to specific users' rooms (e.g. escalation alerts). */
  emitToUsers(userIds: string[], event: string, payload: unknown) {
    for (const id of userIds) this.server.to(`user:${id}`).emit(event, payload)
  }
}
