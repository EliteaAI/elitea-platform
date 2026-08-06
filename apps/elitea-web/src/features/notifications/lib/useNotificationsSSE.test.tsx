/**
 * useNotificationsSSE.test.tsx — issue #92.
 *
 * Runtime config comes from a real `globalThis.elitea_ui_config` object +
 * `resetConfigForTests()` (the `ToolkitEditor.test.tsx` pattern), not a
 * `getConfig` spy: the URL this hook builds IS its contract, so resolving it
 * through the real C6 source chain is what makes the assertion meaningful.
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestEventSource, type TestEventSourceRegistry } from '@/shared/api/sse/testing';
import { resetConfigForTests } from '@/shared/config/get-config';

import { NOTIFICATIONS_QUERY_ROOT } from '../api/useNotifications';
import { useNotificationsSSE } from './useNotificationsSSE';

const globals = globalThis as unknown as Record<string, unknown>;

let registry: TestEventSourceRegistry;

function setConfig(serverUrl?: string): void {
  if (serverUrl === undefined) {
    delete globals['elitea_ui_config'];
  } else {
    globals['elitea_ui_config'] = { vite_server_url: serverUrl, vite_base_uri: '/', vite_public_project_id: 'public-1' };
  }
  resetConfigForTests();
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  registry = installTestEventSource();
  setConfig('/api/v2');
});

afterEach(() => {
  registry.restore();
  setConfig(undefined);
});

describe('useNotificationsSSE', () => {
  it('subscribes to the project-scoped Go SSE route with credentials', () => {
    const queryClient = new QueryClient();
    renderHook(() => useNotificationsSSE('7', vi.fn()), { wrapper: wrapper(queryClient) });

    expect(registry.getOpen()).toHaveLength(1);
    expect(registry.getSources()[0]?.url).toBe('/api/v2/notifications/events/prompt_lib/7');
    expect(registry.getSources()[0]?.withCredentials).toBe(true);
  });

  it('calls onNotify for every notifications_notify event', () => {
    const queryClient = new QueryClient();
    const onNotify = vi.fn();
    renderHook(() => useNotificationsSSE('7', onNotify), { wrapper: wrapper(queryClient) });

    act(() => {
      registry.emit('notifications_notify');
      registry.emit('notifications_notify');
    });
    expect(onNotify).toHaveBeenCalledTimes(2);
  });

  it('invalidates every notifications query on notifications_ready', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useNotificationsSSE('7', vi.fn()), { wrapper: wrapper(queryClient) });

    act(() => {
      registry.emit('notifications_ready');
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: NOTIFICATIONS_QUERY_ROOT });
  });

  it('does not treat notifications_ready as a notify (the two events are not interchangeable)', () => {
    const queryClient = new QueryClient();
    const onNotify = vi.fn();
    renderHook(() => useNotificationsSSE('7', onNotify), { wrapper: wrapper(queryClient) });

    act(() => {
      registry.emit('notifications_ready');
    });
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('opens nothing without a project id, and connects once one arrives', () => {
    const queryClient = new QueryClient();
    const { rerender } = renderHook((projectId?: string) => useNotificationsSSE(projectId, vi.fn()), {
      wrapper: wrapper(queryClient),
      initialProps: undefined,
    });
    expect(registry.getSources()).toHaveLength(0);

    rerender('7');
    expect(registry.getSources()[0]?.url).toBe('/api/v2/notifications/events/prompt_lib/7');
  });

  it('opens nothing when the runtime config never resolved (missing vite_server_url)', () => {
    setConfig(undefined);
    const queryClient = new QueryClient();
    renderHook(() => useNotificationsSSE('7', vi.fn()), { wrapper: wrapper(queryClient) });
    expect(registry.getSources()).toHaveLength(0);
  });

  it('closes the stream on unmount', () => {
    const queryClient = new QueryClient();
    const { unmount } = renderHook(() => useNotificationsSSE('7', vi.fn()), { wrapper: wrapper(queryClient) });
    unmount();
    expect(registry.getOpen()).toHaveLength(0);
  });

  it('keeps one stream open across re-renders with an unstable onNotify identity', () => {
    const queryClient = new QueryClient();
    const { rerender } = renderHook(() => useNotificationsSSE('7', () => undefined), { wrapper: wrapper(queryClient) });
    rerender();
    rerender();
    expect(registry.getSources()).toHaveLength(1);
  });

  it('reconnects to the new project stream when the project id changes', () => {
    const queryClient = new QueryClient();
    const { rerender } = renderHook((projectId: string) => useNotificationsSSE(projectId, vi.fn()), {
      wrapper: wrapper(queryClient),
      initialProps: '7',
    });
    rerender('9');

    const sources = registry.getSources();
    expect(sources).toHaveLength(2);
    expect(sources[0]?.closed).toBe(true);
    expect(sources[1]?.url).toBe('/api/v2/notifications/events/prompt_lib/9');
  });
  it('warns — and leaves the surface working — when the stream fails (429 from the admission cap, 403, 503)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const queryClient = new QueryClient();
    const onNotify = vi.fn();
    renderHook(() => useNotificationsSSE('7', onNotify), { wrapper: wrapper(queryClient) });

    act(() => {
      registry.fail();
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('notifications SSE stream failed');
    expect(onNotify).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
