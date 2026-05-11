import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets'
import { UseGuards } from '@nestjs/common'
import { Server, Socket } from 'socket.io'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'

@WebSocketGateway({ cors: { origin: '*', credentials: true } })
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
    } catch {
      socket.disconnect()
    }
  }

  handleDisconnect(socket: Socket) {
    // cleanup handled by socket.io automatically
  }

  @SubscribeMessage('join:chat')
  handleJoinChat(@ConnectedSocket() socket: Socket, chatId: string) {
    socket.join(`chat:${chatId}`)
  }

  @SubscribeMessage('leave:chat')
  handleLeaveChat(@ConnectedSocket() socket: Socket, chatId: string) {
    socket.leave(`chat:${chatId}`)
  }

  emitNewMessage(chatId: string, payload: unknown) {
    this.server.to(`chat:${chatId}`).emit('message:new', payload)
  }

  emitChatUpdated(chat: unknown) {
    this.server.emit('chat:updated', chat)
  }

  emitNewChat(chat: unknown) {
    this.server.emit('chat:new', chat)
  }
}
