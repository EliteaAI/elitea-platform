/**
 * In-memory `EventSource` double (issue #92) — the SSE counterpart of
 * `shared/api/socket/testing.ts`, and the same kind of sanctioned
 * substitution: R-M1 bans `vi.mock`-ing libraries, and this is not one. It
 * installs a stand-in for a BROWSER GLOBAL that jsdom simply does not
 * implement (`typeof EventSource === 'undefined'` under the `node` vitest
 * project — verified), exactly like the `ResizeObserver` stubs
 * `ToolkitEditor.test.tsx` and `CredentialTypeSelector.test.tsx` already
 * install for the same jsdom gap.
 *
 * MSW cannot cover this seam either: it intercepts `fetch`/XHR, and
 * `EventSource` in jsdom is not implemented on top of either — there is no
 * network boundary to intercept, so the boundary this file substitutes at
 * IS the network boundary (§6.2).
 *
 * Deliberately independent of `useEventSource.ts` (same discipline as
 * `socket/testing.ts`): a from-scratch implementation of the WHATWG shape
 * the hook actually touches, so it stays auditable on its own.
 */

/** @public Test-only: one simulated open connection. */
export interface TestEventSource {
  /** The URL the system under test opened. */
  readonly url: string;
  /** The `withCredentials` flag it passed (the notifications stream requires `true` — session-cookie auth). */
  readonly withCredentials: boolean;
  /** `true` once the hook's cleanup called `close()`. */
  readonly closed: boolean;
  /**
   * Push one named server event at this connection, driving any handler the
   * hook registered for `name`. `lastEventId` is the `id:` line the real route
   * writes before every frame (`events.go` emits `id: <cursor>`) — the value a
   * resume has to send back, so a test that exercises resume must be able to
   * set it.
   */
  emit(name: string, data?: string, lastEventId?: string): void;
  /**
   * The WHATWG `readyState`: 0 CONNECTING, 1 OPEN, 2 CLOSED. A caller reads
   * it to tell a permanent failure from a mid-stream drop, because those two
   * fire the SAME `error` event and need opposite handling.
   */
  readonly readyState: number;
  /**
   * Simulate a connection that FAILED. This is the `error` event a real
   * `EventSource` fires on a non-2xx status (429/403/503 from both Go SSE
   * routes). It also fires on a wrong content type. The real object does not retry after an
   * HTTP status, so `readyState` goes to CLOSED and the caller owns the
   * reopen.
   */
  fail(): void;
  /**
   * Simulate a mid-stream DROP — the same `error` event, but the browser is
   * already reconnecting on its own, so `readyState` stays CONNECTING. A
   * caller that reopens here would run two streams for one principal.
   */
  drop(): void;
}

/** @public Test-only: the handle `installTestEventSource()` returns. */
export interface TestEventSourceRegistry {
  /** Every connection opened since install, in open order — closed ones included, so a test can assert a teardown actually happened. */
  getSources(): readonly TestEventSource[];
  /** Connections still open right now. */
  getOpen(): readonly TestEventSource[];
  /** Push `name` at every still-open connection. Returns how many received it. */
  emit(name: string, data?: string, lastEventId?: string): number;
  /** Fail every still-open connection. Returns how many were failed. */
  fail(): number;
  /** Drop every still-open connection mid-stream. Returns how many were dropped. */
  drop(): number;
  /** Restore whatever `globalThis.EventSource` was before install (usually: absent). */
  restore(): void;
}

const globals = globalThis as unknown as Record<string, unknown>;

/** WHATWG `EventSource` ready states. */
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class FakeEventSource implements TestEventSource {
  readonly url: string;
  readonly withCredentials: boolean;
  closed = false;
  readyState = CONNECTING;
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
  }

  addEventListener(name: string, handler: (event: MessageEvent) => void): void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(handler);
  }

  removeEventListener(name: string, handler: (event: MessageEvent) => void): void {
    this.listeners.get(name)?.delete(handler);
  }

  close(): void {
    this.closed = true;
    this.readyState = CLOSED;
    this.listeners.clear();
  }

  emit(name: string, data = '', lastEventId = ''): void {
    // `open` is what moves a real connection to OPEN, so the double does the
    // same. A caller's `onOpen` uses that transition as its "this was a real
    // stream" signal.
    if (name === 'open') this.readyState = OPEN;
    // Snapshot: a handler is free to unsubscribe while the batch is being
    // delivered, and mutating a Set mid-iteration is exactly the kind of
    // bug a double should not invent.
    for (const handler of Array.from(this.listeners.get(name) ?? [])) {
      handler(new MessageEvent(name, { data, lastEventId }));
    }
  }

  fail(): void {
    this.readyState = CLOSED;
    for (const handler of Array.from(this.listeners.get('error') ?? [])) {
      handler(new MessageEvent('error'));
    }
  }

  drop(): void {
    this.readyState = CONNECTING;
    for (const handler of Array.from(this.listeners.get('error') ?? [])) {
      handler(new MessageEvent('error'));
    }
  }
}

/**
 * Install the double as `globalThis.EventSource` for the current test.
 * Always pair with `restore()` in an `afterEach` — a leaked global would
 * make the next file's "degrades when EventSource is unavailable" test lie.
 */
export function installTestEventSource(): TestEventSourceRegistry {
  const had = Object.prototype.hasOwnProperty.call(globals, 'EventSource');
  const previous = globals['EventSource'];
  const sources: FakeEventSource[] = [];

  class Recording extends FakeEventSource {
    constructor(url: string, init?: { withCredentials?: boolean }) {
      super(url, init);
      sources.push(this);
    }
  }
  globals['EventSource'] = Recording;

  return {
    getSources: () => [...sources],
    getOpen: () => sources.filter((source) => !source.closed),
    emit: (name, data, lastEventId) => {
      const open = sources.filter((source) => !source.closed);
      for (const source of open) source.emit(name, data, lastEventId);
      return open.length;
    },
    fail: () => {
      const open = sources.filter((source) => !source.closed);
      for (const source of open) source.fail();
      return open.length;
    },
    drop: () => {
      const open = sources.filter((source) => !source.closed);
      for (const source of open) source.drop();
      return open.length;
    },
    restore: () => {
      if (had) {
        globals['EventSource'] = previous;
      } else {
        delete globals['EventSource'];
      }
    },
  };
}
