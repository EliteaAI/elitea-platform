import { io } from 'socket.io-client';

export function createSocketClient(url: string): unknown {
  return io(url);
}
