/**
 * useEventSource.test.tsx — issue #92, the shared SSE primitive.
 *
 * Uses `./testing.ts`'s `installTestEventSource()` (jsdom implements no
 * `EventSource`; see that file's header for why this substitution is the
 * network boundary, not a library mock).
 */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installTestEventSource, type TestEventSourceRegistry } from './testing';
import { useEventSource } from './useEventSource';

let registry: TestEventSourceRegistry | undefined;

afterEach(() => {
  registry?.restore();
  registry = undefined;
});

interface ProbeProps {
  readonly url: string | null | undefined;
  readonly handlers: Record<string, (event: MessageEvent) => void>;
  readonly onError?: (event: Event) => void;
  readonly onOpen?: (event: Event) => void;
}

function Probe({ url, handlers, onError, onOpen }: ProbeProps): null {
  useEventSource(url, handlers, { ...(onError ? { onError } : {}), ...(onOpen ? { onOpen } : {}) });
  return null;
}

describe('useEventSource', () => {
  it('opens one credentialed connection to the url and delivers named events to their handler', () => {
    registry = installTestEventSource();
    const onPing = vi.fn<(event: MessageEvent) => void>();
    render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: onPing }}
      />,
    );

    expect(registry.getOpen()).toHaveLength(1);
    expect(registry.getSources()[0]?.url).toBe('/api/v2/stream');
    // EventSource cannot send an Authorization header — the session cookie
    // is the whole auth story, so this flag is not optional.
    expect(registry.getSources()[0]?.withCredentials).toBe(true);

    act(() => {
      registry?.emit('ping', 'payload');
    });
    expect(onPing).toHaveBeenCalledTimes(1);
    const [delivered] = onPing.mock.calls[0] ?? [];
    expect(delivered?.data).toBe('payload');
  });

  it('ignores events with no registered handler', () => {
    registry = installTestEventSource();
    const onPing = vi.fn();
    render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: onPing }}
      />,
    );

    act(() => {
      registry?.emit('other');
    });
    expect(onPing).not.toHaveBeenCalled();
  });

  it('does not reconnect when only the handler identities change (fresh closures every render)', () => {
    registry = installTestEventSource();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: first }}
      />,
    );
    rerender(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: second }}
      />,
    );

    expect(registry.getSources()).toHaveLength(1);
    act(() => {
      registry?.emit('ping');
    });
    // The LATEST handler runs — the ref is refreshed on every render, so a
    // stale closure never wins.
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect when the same event names arrive in a different key order', () => {
    registry = installTestEventSource();
    const { rerender } = render(
      <Probe
        url="/api/v2/stream"
        handlers={{ a: vi.fn(), b: vi.fn() }}
      />,
    );
    rerender(
      <Probe
        url="/api/v2/stream"
        handlers={{ b: vi.fn(), a: vi.fn() }}
      />,
    );
    expect(registry.getSources()).toHaveLength(1);
  });

  it('reconnects when the url changes, closing the previous connection', () => {
    registry = installTestEventSource();
    const { rerender } = render(
      <Probe
        url="/api/v2/one"
        handlers={{ ping: vi.fn() }}
      />,
    );
    rerender(
      <Probe
        url="/api/v2/two"
        handlers={{ ping: vi.fn() }}
      />,
    );

    const sources = registry.getSources();
    expect(sources).toHaveLength(2);
    expect(sources[0]?.closed).toBe(true);
    expect(sources[1]?.closed).toBe(false);
    expect(sources[1]?.url).toBe('/api/v2/two');
  });

  it('reconnects when the SET of event names changes, so a newly added name is actually subscribed', () => {
    registry = installTestEventSource();
    const onLate = vi.fn();
    const { rerender } = render(
      <Probe
        url="/api/v2/stream"
        handlers={{ early: vi.fn() }}
      />,
    );
    rerender(
      <Probe
        url="/api/v2/stream"
        handlers={{ early: vi.fn(), late: onLate }}
      />,
    );

    expect(registry.getSources()).toHaveLength(2);
    act(() => {
      registry?.emit('late');
    });
    expect(onLate).toHaveBeenCalledTimes(1);
  });

  it('closes the connection on unmount', () => {
    registry = installTestEventSource();
    const { unmount } = render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
      />,
    );
    unmount();
    expect(registry.getOpen()).toHaveLength(0);
    expect(registry.getSources()[0]?.closed).toBe(true);
  });

  it('opens nothing for a null, undefined or empty url, then connects once one arrives', () => {
    registry = installTestEventSource();
    const { rerender } = render(
      <Probe
        url={null}
        handlers={{ ping: vi.fn() }}
      />,
    );
    rerender(
      <Probe
        url={undefined}
        handlers={{ ping: vi.fn() }}
      />,
    );
    rerender(
      <Probe
        url=""
        handlers={{ ping: vi.fn() }}
      />,
    );
    expect(registry.getSources()).toHaveLength(0);

    rerender(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
      />,
    );
    expect(registry.getOpen()).toHaveLength(1);
  });

  it('opens a connection with no listeners at all when the handler map is empty', () => {
    registry = installTestEventSource();
    render(
      <Probe
        url="/api/v2/stream"
        handlers={{}}
      />,
    );
    expect(registry.getOpen()).toHaveLength(1);
    // Nothing registered ⇒ nothing delivered, and no crash on an empty
    // event-name key (the '' split artefact this hook explicitly skips).
    expect(registry.emit('anything')).toBe(1);
  });

  it('degrades to a no-op — never a crash — in a runtime with no EventSource (jsdom, SSR)', () => {
    // NOT installing the double: this is jsdom's real, unpatched state.
    expect(typeof (globalThis as unknown as Record<string, unknown>)['EventSource']).toBe('undefined');
    expect(() =>
      render(
        <Probe
          url="/api/v2/stream"
          handlers={{ ping: vi.fn() }}
        />,
      ),
    ).not.toThrow();
  });
});

describe('useEventSource — connection failure', () => {
  it('reports a failed stream through onError (EventSource does NOT retry after an HTTP status)', () => {
    registry = installTestEventSource();
    const onError = vi.fn();
    render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onError={onError}
      />,
    );

    act(() => {
      registry?.fail();
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not put `error` in the connection cache key — a caller-supplied onError never reopens the stream', () => {
    registry = installTestEventSource();
    const { rerender } = render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onError={vi.fn()}
      />,
    );
    rerender(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onError={vi.fn()}
      />,
    );
    expect(registry.getSources()).toHaveLength(1);
  });

  it('calls the LATEST onError, not a stale closure', () => {
    registry = installTestEventSource();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onError={first}
      />,
    );
    rerender(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onError={second}
      />,
    );

    act(() => {
      registry?.fail();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a failure with no onError supplied is a harmless no-op', () => {
    registry = installTestEventSource();
    render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
      />,
    );
    expect(() =>
      act(() => {
        registry?.fail();
      }),
    ).not.toThrow();
  });
});

describe('useEventSource — connection open (issue 310)', () => {
  it('reports a successful connection through onOpen', () => {
    registry = installTestEventSource();
    const onOpen = vi.fn();
    render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onOpen={onOpen}
      />,
    );

    act(() => {
      registry?.emit('open');
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not put `open` in the connection cache key — a caller-supplied onOpen never reopens the stream', () => {
    registry = installTestEventSource();
    const { rerender } = render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onOpen={vi.fn()}
      />,
    );
    rerender(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onOpen={vi.fn()}
      />,
    );
    expect(registry.getSources()).toHaveLength(1);
  });

  it('calls the LATEST onOpen, not a stale closure', () => {
    registry = installTestEventSource();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onOpen={first}
      />,
    );
    rerender(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
        onOpen={second}
      />,
    );

    act(() => {
      registry?.emit('open');
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a successful open with no onOpen supplied is a harmless no-op', () => {
    registry = installTestEventSource();
    render(
      <Probe
        url="/api/v2/stream"
        handlers={{ ping: vi.fn() }}
      />,
    );
    expect(() =>
      act(() => {
        registry?.emit('open');
      }),
    ).not.toThrow();
  });
});
