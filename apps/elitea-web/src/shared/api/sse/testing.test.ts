/**
 * testing.test.ts — the SSE double's own contract (issue #92), mirroring
 * `shared/api/socket/testing.test.ts`. A double nobody trusts is worse than
 * no double: every behaviour `useEventSource.test.tsx` and
 * `useNotificationsSSE.test.tsx` lean on is asserted here directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installTestEventSource, type TestEventSourceRegistry } from './testing';

const globals = globalThis as unknown as Record<string, unknown>;

let registry: TestEventSourceRegistry | undefined;

afterEach(() => {
  registry?.restore();
  registry = undefined;
});

interface FakeSource {
  addEventListener(name: string, handler: (event: MessageEvent) => void): void;
  removeEventListener(name: string, handler: (event: MessageEvent) => void): void;
  close(): void;
}

function construct(url: string, init?: { withCredentials?: boolean }): FakeSource {
  const Ctor = globals['EventSource'] as new (url: string, init?: { withCredentials?: boolean }) => FakeSource;
  return new Ctor(url, init);
}

describe('installTestEventSource', () => {
  it('installs a constructor that records url and withCredentials, defaulting the flag to false', () => {
    registry = installTestEventSource();
    construct('/a', { withCredentials: true });
    construct('/b');

    expect(registry.getSources().map((source) => source.url)).toEqual(['/a', '/b']);
    expect(registry.getSources().map((source) => source.withCredentials)).toEqual([true, false]);
  });

  it('delivers emitted events as MessageEvents, with empty-string data by default', () => {
    registry = installTestEventSource();
    const source = construct('/a');
    const handler = vi.fn<(event: MessageEvent) => void>();
    source.addEventListener('tick', handler);

    registry.emit('tick');
    const [defaulted] = handler.mock.calls[0] ?? [];
    expect(defaulted?.data).toBe('');

    registry.emit('tick', 'body');
    const [explicit] = handler.mock.calls[1] ?? [];
    expect(explicit?.data).toBe('body');
  });

  it('stops delivering to a removed listener', () => {
    registry = installTestEventSource();
    const source = construct('/a');
    const handler = vi.fn();
    source.addEventListener('tick', handler);
    source.removeEventListener('tick', handler);

    registry.emit('tick');
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports open vs closed connections, and emit() skips the closed ones', () => {
    registry = installTestEventSource();
    const first = construct('/a');
    construct('/b');
    const handler = vi.fn();
    first.addEventListener('tick', handler);
    first.close();

    expect(registry.getSources()).toHaveLength(2);
    expect(registry.getOpen()).toHaveLength(1);
    expect(registry.emit('tick')).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('restores the global — deleting it when there was none, putting back the previous one when there was', () => {
    registry = installTestEventSource();
    expect(globals['EventSource']).toBeDefined();
    registry.restore();
    registry = undefined;
    expect('EventSource' in globals).toBe(false);

    const sentinel = class {};
    globals['EventSource'] = sentinel;
    try {
      const nested = installTestEventSource();
      expect(globals['EventSource']).not.toBe(sentinel);
      nested.restore();
      expect(globals['EventSource']).toBe(sentinel);
    } finally {
      delete globals['EventSource'];
    }
  });
});
