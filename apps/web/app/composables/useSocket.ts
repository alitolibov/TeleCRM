import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

export function useSocket() {
  const config = useRuntimeConfig()

  /**
   * Idempotent connect — must NEVER recreate an existing socket, otherwise
   * listeners attached by earlier callers (e.g. page) would silently lose
   * their socket when a later caller (e.g. layout) re-connects.
   *
   * If the socket exists at all (connecting, connected, or briefly down for
   * an auto-reconnect), we return it untouched. Only when there is no socket
   * at all do we create a fresh one.
   */
  function connect(token: string) {
    if (socket) return socket
    socket = io(config.public.wsUrl as string, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
    socket.on('connect', () => console.log('[ws] connected', socket?.id))
    socket.on('disconnect', (reason) => console.log('[ws] disconnected:', reason))
    socket.on('connect_error', (err) => console.error('[ws] connect_error:', err.message))
    return socket
  }

  function disconnect() {
    socket?.disconnect()
    socket = null
  }

  function on(event: string, fn: (...args: any[]) => void) {
    socket?.on(event, fn)
  }

  function off(event: string, fn: (...args: any[]) => void) {
    socket?.off(event, fn)
  }

  function emit(event: string, ...args: any[]) {
    socket?.emit(event, ...args)
  }

  return { connect, disconnect, on, off, emit }
}
