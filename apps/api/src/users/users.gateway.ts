import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { Inject, forwardRef } from '@nestjs/common'
import { UsersService } from './users.service'

@WebSocketGateway({
  cors: {
    origin: (process.env.WEB_URL ?? 'http://localhost:3001').split(',').map(o => o.trim()),
    credentials: true,
  },
})
export class UsersGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    @Inject(forwardRef(() => UsersService)) private users: UsersService,
  ) {}

  async handleConnection(socket: Socket) {
    // Auth is done by ChatsGateway already (same socket, same handshake) —
    // but we still want our own data on this gateway's socket reference.
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers.authorization?.replace('Bearer ', '')
      const payload = this.jwtService.verify(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      })
      socket.data.userId = payload.sub
    } catch {
      // ChatsGateway will disconnect on bad auth; we don't double-disconnect here.
    }
  }

  /** Client tab pings every 30 s while open — keeps lastSeenAt fresh. */
  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() socket: Socket) {
    if (!socket.data.userId) return
    await this.users.heartbeat(socket.data.userId)
  }

  /** Broadcast status flip to every connected manager (badges, lists, etc.). */
  emitUserStatus(payload: { id: string; status: 'online' | 'offline'; lastSeenAt: string | null }) {
    this.server.emit('user:status', payload)
  }
}
