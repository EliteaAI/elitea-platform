import { io } from 'socket.io-client';

export function connect(): unknown {
  return io('/');
}
