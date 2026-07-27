/**
 * client.ts — factory, connection-state machine, emit/on/off validation
 * wrapping. `ioFactory` injection lets these tests drive real socket.io
 * lifecycle EVENT NAMES (connect/disconnect/reconnect_attempt/...) without
 * opening a network connection, proving client.ts's OWN wiring logic —
 * distinct from testing.ts's double, which Wave-2 consumers use instead of
 * `vi.mock('socket.io-client')` (R-M1).
 */
import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';

import { SocketClientContext, createSocketClient, useSocketClient } from './client';
import type { SocketIoFactory } from './client';
import type { EmitPayloadOf } from './events';

/** Minimal duck-typed Socket + Manager (`.io`) double — real EventEmitter semantics (on/off/emit), nothing socket.io-client-specific. */
function createFakeSocket() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const managerListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emittedCalls: Array<{ event: string; payload: unknown }> = [];
  const disconnect = vi.fn();

  function add(map: Map<string, Set<(...args: unknown[]) => void>>, event: string, handler: (...args: unknown[]) => void) {
    let set = map.get(event);
    if (!set) {
      set = new Set();
      map.set(event, set);
    }
    set.add(handler);
  }
  function remove(map: Map<string, Set<(...args: unknown[]) => void>>, event: string, handler: (...args: unknown[]) => void) {
    map.get(event)?.delete(handler);
  }

  const fake = {
    on: (event: string, handler: (...args: unknown[]) => void) => add(listeners, event, handler),
    off: (event: string, handler: (...args: unknown[]) => void) => remove(listeners, event, handler),
    emit: (event: string, payload: unknown) => {
      emittedCalls.push({ event, payload });
      return fake;
    },
    disconnect,
    io: {
      on: (event: string, handler: (...args: unknown[]) => void) => add(managerListeners, event, handler),
      off: (event: string, handler: (...args: unknown[]) => void) => remove(managerListeners, event, handler),
    },
    trigger(event: string, ...args: unknown[]) {
      for (const h of listeners.get(event) ?? []) h(...args);
    },
    triggerManager(event: string, ...args: unknown[]) {
      for (const h of managerListeners.get(event) ?? []) h(...args);
    },
    emittedCalls,
  };
  return fake;
}

function makeClient() {
  const fakeSocket = createFakeSocket();
  const ioFactory = vi.fn((_url?: string, _opts?: Record<string, unknown>) => fakeSocket as unknown as Socket) as unknown as SocketIoFactory & {
      mock: { calls: Array<[string, Record<string, unknown>]> };
    };
  const client = createSocketClient({ url: 'http://socket.test', ioFactory });
  return { client, fakeSocket, ioFactory };
}

describe('createSocketClient', () => {
  it('throws a TypeError (programmer error) when url is missing or empty — mirrors http.ts createHttpClient', () => {
    expect(() => createSocketClient({ url: '' })).toThrow(TypeError);
    // @ts-expect-error -- deliberately omitting the required field
    expect(() => createSocketClient({})).toThrow(TypeError);
  });

  it('is a factory: two calls produce two independent clients with independent connection stores', () => {
    const a = makeClient();
    const b = makeClient();
    a.fakeSocket.trigger('connect');
    expect(a.client.getConnectionState()).toBe('connected');
    expect(b.client.getConnectionState()).toBe('connecting'); // untouched
  });

  it('passes reconnectionDelayMax: 2000 to the io() call, preserved from the old app (root.jsx:40)', () => {
    const { ioFactory } = makeClient();
    expect(ioFactory).toHaveBeenCalledWith('http://socket.test', expect.objectContaining({ reconnectionDelayMax: 2000 }));
  });

  it('never sets extraHeaders — spec §5.5 "No extraHeaders bearer token"', () => {
    const { ioFactory } = makeClient();
    const opts = ioFactory.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('extraHeaders');
  });

  it('falls back to the real socket.io-client io() when no ioFactory override is given', () => {
    // A reserved/typically-unassigned TCP port (discard, RFC 863): the
    // connection attempt fails fast in the background without hanging the
    // test — nothing here awaits an actual connection. disconnect() stops
    // socket.io-client's own reconnection loop immediately so no handle is
    // left open after the test completes.
    const client = createSocketClient({ url: 'http://127.0.0.1:9' });
    expect(client.getConnectionState()).toBe('connecting');
    client.disconnect();
  });

  it('omits `path` entirely (not `path: undefined`) when not given', () => {
    const { ioFactory } = makeClient();
    const opts = ioFactory.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('path' in opts).toBe(false);
  });

  it('passes `path` through when given', () => {
    const fakeSocket = createFakeSocket();
    const ioFactory = vi.fn((_url?: string, _opts?: Record<string, unknown>) => fakeSocket as unknown as Socket) as unknown as SocketIoFactory & {
      mock: { calls: Array<[string, Record<string, unknown>]> };
    };
    createSocketClient({ url: 'http://socket.test', path: '/custom/socket.io', ioFactory });
    const opts = ioFactory.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts.path).toBe('/custom/socket.io');
  });
});

describe('RED/GREEN proof (c) — connection-state machine over real socket.io lifecycle event names', () => {
  it('connecting -> connected -> reconnecting -> disconnected, driven by connect / socket.io reconnect_attempt / disconnect', () => {
    const { client, fakeSocket } = makeClient();

    expect(client.getConnectionState()).toBe('connecting');

    fakeSocket.trigger('connect');
    expect(client.getConnectionState()).toBe('connected');

    fakeSocket.triggerManager('reconnect_attempt', 1);
    expect(client.getConnectionState()).toBe('reconnecting');

    fakeSocket.trigger('disconnect', 'transport close');
    expect(client.getConnectionState()).toBe('disconnected');
  });

  it('a successful reconnect (Manager "reconnect") returns to connected', () => {
    const { client, fakeSocket } = makeClient();
    fakeSocket.trigger('connect');
    fakeSocket.trigger('disconnect', 'ping timeout');
    fakeSocket.triggerManager('reconnect_attempt', 1);
    expect(client.getConnectionState()).toBe('reconnecting');
    fakeSocket.triggerManager('reconnect', 1);
    expect(client.getConnectionState()).toBe('connected');
  });

  it('connect_error before ever connecting moves to error, with the message recorded', () => {
    const { client, fakeSocket } = makeClient();
    fakeSocket.trigger('connect_error', new Error('ECONNREFUSED'));
    expect(client.getConnectionState()).toBe('error');
  });

  it('a per-attempt reconnect_error keeps the state at reconnecting (still trying, not given up yet)', () => {
    const { client, fakeSocket } = makeClient();
    fakeSocket.trigger('connect');
    fakeSocket.trigger('disconnect', 'transport close');
    fakeSocket.triggerManager('reconnect_attempt', 1);
    fakeSocket.triggerManager('reconnect_error', new Error('ETIMEDOUT'));
    expect(client.getConnectionState()).toBe('reconnecting');
  });

  it('exhausting reconnection attempts (Manager "reconnect_failed") moves to error', () => {
    const { client, fakeSocket } = makeClient();
    fakeSocket.trigger('connect');
    fakeSocket.trigger('disconnect', 'transport close');
    fakeSocket.triggerManager('reconnect_attempt', 1);
    fakeSocket.triggerManager('reconnect_failed');
    expect(client.getConnectionState()).toBe('error');
  });

  it('useConnectionState() is a reactive hook that re-renders on transitions', () => {
    const { client, fakeSocket } = makeClient();
    const { result } = renderHook(() => client.useConnectionState());
    expect(result.current).toBe('connecting');
    act(() => {
      fakeSocket.trigger('connect');
    });
    expect(result.current).toBe('connected');
  });
});

describe('emit()', () => {
  it('forwards event + payload to the underlying socket and returns true', () => {
    const { client, fakeSocket } = makeClient();
    const ok = client.emit('chat_enter_room', { conversation_id: 'c1' });
    expect(ok).toBe(true);
    expect(fakeSocket.emittedCalls).toEqual([{ event: 'chat_enter_room', payload: { conversation_id: 'c1' } }]);
  });

  it('warns (does not throw) when the payload fails the generated emit schema, and still forwards it', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client, fakeSocket } = makeClient();
    // chat_canvas_join's emitSchema is a looseObject — pass a non-object to force a schema mismatch.
    const malformed = 'not-an-object' as unknown as EmitPayloadOf<'chat_canvas_join'>;
    expect(() => client.emit('chat_canvas_join', malformed)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(fakeSocket.emittedCalls).toHaveLength(1); // still forwarded — never silently dropped
    warnSpy.mockRestore();
  });
});

describe('on() / off()', () => {
  it('delivers validated payloads to the caller-supplied handler', () => {
    const { client, fakeSocket } = makeClient();
    const received: unknown[] = [];
    client.on('mcp_status', (payload) => received.push(payload));
    fakeSocket.trigger('mcp_status', { project_id: 'p1', connected: true, type: 'confluence' });
    expect(received).toEqual([{ project_id: 'p1', connected: true, type: 'confluence' }]);
  });

  it('warns but still delivers when the received payload fails the generated receive schema', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client, fakeSocket } = makeClient();
    const received: unknown[] = [];
    client.on('asr_transcript_delta', (payload) => received.push(payload));
    fakeSocket.trigger('asr_transcript_delta', { delta: 123 }); // delta should be a string
    expect(warnSpy).toHaveBeenCalled();
    expect(received).toHaveLength(1); // never silently dropped
    warnSpy.mockRestore();
  });

  it('off() removes exactly the registered handler — no more deliveries after off', () => {
    const { client, fakeSocket } = makeClient();
    const received: unknown[] = [];
    const handler = (payload: unknown): void => {
      received.push(payload);
    };
    client.on('notifications_notify', handler);
    fakeSocket.trigger('notifications_notify', {});
    client.off('notifications_notify', handler);
    fakeSocket.trigger('notifications_notify', {});
    expect(received).toHaveLength(1);
  });

  it('off() on a handler that was never registered is a no-op, not a throw', () => {
    const { client } = makeClient();
    expect(() => client.off('notifications_notify', () => undefined)).not.toThrow();
  });
});

describe('disconnect()', () => {
  it('calls through to the underlying socket', () => {
    const { client, fakeSocket } = makeClient();
    client.disconnect();
    expect(fakeSocket.disconnect).toHaveBeenCalledOnce();
  });
});

describe('SocketClientContext / useSocketClient', () => {
  it('throws a clear error when no provider is mounted', () => {
    const { result } = renderHook(() => {
      try {
        return useSocketClient();
      } catch (err) {
        return err;
      }
    });
    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toMatch(/no SocketClientContext\.Provider/);
  });

  it('returns the injected client when a provider is mounted', () => {
    const { client } = makeClient();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(SocketClientContext.Provider, { value: client }, children);
    const { result } = renderHook(() => useSocketClient(), { wrapper });
    expect(result.current).toBe(client);
  });
});
