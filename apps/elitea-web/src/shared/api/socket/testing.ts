/**
 * In-memory socket double (unit S5, spec §5.5 / §6.2). This is the R-M1
 * sanctioned exception: "Library mocks are allowed only for
 * socket.io-client — use the double instead." Every integration test that
 * needs a `SocketClient` (chat streaming, room membership, the sidebar
 * connectivity indicator, ...) uses `createTestSocketClient()` here instead
 * of `vi.mock('socket.io-client')`.
 *
 * Deliberately independent of client.ts's internals — this is a from-
 * scratch implementation of the same `SocketClient` shape backed by plain
 * JS Maps/Sets, not a wrapper around a stubbed socket.io `Socket`. That
 * keeps it auditable on its own (no hidden coupling to socket.io-client's
 * real event machinery) and is exactly what a "double" should be: the same
 * observable behaviour, a completely different, simpler implementation.
 *
 * `socket.io-client`'s `Socket` type is imported type-only (erased at
 * build time) purely so `TestSocketClient.socket` satisfies
 * `SocketClient['socket']` — the only other place besides client.ts that
 * references the package at all (R-A3).
 */
import type { Socket } from 'socket.io-client';
import { create } from 'zustand';

import { SOCKET_EVENTS, type EmitPayloadOf, type EmittableEventName, type ReceivePayloadOf, type ReceivableEventName } from './events';
import type { ConnectionState, ConnectionStoreState, SocketClient } from './client';

interface EmittedRecord {
  readonly event: EmittableEventName;
  readonly payload: unknown;
}

/** @public Test-only surface: consumed by every Wave-2 integration test that needs a SocketClient. */
export interface TestSocketClient extends SocketClient {
  /** Simulate the server pushing `event` to this client — drives any handler registered via `.on(event, ...)`, exactly like a real inbound socket.io message. */
  simulateServerEvent<E extends ReceivableEventName>(event: E, payload: ReceivePayloadOf<E>): void;
  /** Everything the system under test emitted via `.emit(...)`, in call order. Pass `event` to filter. Use this to assert real behaviour (e.g. "the room-leave hook actually emitted chat_leave_rooms on unmount"), never mock call counts (R-M1). */
  getEmitted(event?: EmittableEventName): readonly EmittedRecord[];
  /** Directly drive the connection-state machine (connecting|connected|reconnecting|disconnected|error) for tests asserting UI reaction to connectivity — e.g. the sidebar indicator (SHELL-012). */
  setConnectionState(status: ConnectionState, lastError?: string | null): void;
  /** Clears getEmitted()'s recorded history without resetting listeners or connection state. */
  clearEmitted(): void;
}

function warnPayloadMismatch(direction: 'emit' | 'receive', event: string, issues: unknown): void {
  // eslint-disable-next-line no-console -- same contract as client.ts: warn, never throw or silently drop
  console.warn(`socket/testing: ${direction}("${event}") payload failed schema validation`, issues);
}

/** A factory, matching client.ts's createSocketClient — every test gets its own isolated double, never a shared module-scope instance (R-S2). */
export function createTestSocketClient(): TestSocketClient {
  const listeners = new Map<ReceivableEventName, Set<(payload: unknown) => void>>();
  const emitted: EmittedRecord[] = [];
  let disconnected = false;

  const useConnectionStore = create<ConnectionStoreState>(() => ({ status: 'connecting', lastError: null }));

  function emit<E extends EmittableEventName>(event: E, payload: EmitPayloadOf<E>): boolean {
    const schema = SOCKET_EVENTS[event].emitSchema;
    // Same defense-in-depth rationale as client.ts's emit() — proven
    // unreachable for typed callers by events.test.ts's invariant check.
    /* v8 ignore next 3 */
    if (schema) {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) warnPayloadMismatch('emit', event, parsed.error.issues);
    }
    emitted.push({ event, payload });
    return !disconnected;
  }

  function on<E extends ReceivableEventName>(event: E, handler: (payload: ReceivePayloadOf<E>) => void): void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
  }

  function off<E extends ReceivableEventName>(event: E, handler: (payload: ReceivePayloadOf<E>) => void): void {
    listeners.get(event)?.delete(handler as (payload: unknown) => void);
  }

  function simulateServerEvent<E extends ReceivableEventName>(event: E, payload: ReceivePayloadOf<E>): void {
    const schema = SOCKET_EVENTS[event].receiveSchema;
    // Same defense-in-depth rationale — proven unreachable for typed
    // callers by events.test.ts's invariant check.
    /* v8 ignore next 3 */
    if (schema) {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) warnPayloadMismatch('receive', event, parsed.error.issues);
    }
    for (const handler of listeners.get(event) ?? []) {
      handler(payload);
    }
  }

  // Minimal duck-typed stand-in for the real socket.io-client Socket — only
  // the handful of members any real call site touches as an escape hatch
  // (SocketClient.socket's own doc comment: "prefer emit/on"). Cast is safe
  // because nothing in this module's own emit/on/off path reads through it.
  const fakeSocket = {
    connected: !disconnected,
    disconnected,
    id: 'test-socket-client',
  } as unknown as Socket;

  return {
    socket: fakeSocket,
    getConnectionState: () => useConnectionStore.getState().status,
    useConnectionState: () => useConnectionStore((s) => s.status),
    emit,
    on,
    off,
    disconnect: () => {
      disconnected = true;
      useConnectionStore.setState({ status: 'disconnected', lastError: null });
    },
    simulateServerEvent,
    getEmitted: (event) => (event === undefined ? [...emitted] : emitted.filter((e) => e.event === event)),
    setConnectionState: (status, lastError = null) => useConnectionStore.setState({ status, lastError }),
    clearEmitted: () => {
      emitted.length = 0;
    },
  };
}
