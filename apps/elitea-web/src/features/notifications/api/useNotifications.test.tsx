/**
 * useNotifications.test.tsx — hook-layer coverage for the TanStack Query
 * wrappers over `./notifications.ts` (unit A11). Mirrors
 * `features/credentials/api/useConfigurations.test.tsx`'s (unit A7)
 * pattern: real `eliteaFetch` client, MSW-mocked, no `vi.mock()` of
 * application code (R-M1).
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '../../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import {
  NOTIFICATIONS_QUERY_ROOT,
  useBulkDeleteNotifications,
  useBulkMarkSeenNotifications,
  useDeleteNotification,
  useNotificationsList,
  useReadNotification,
} from './useNotifications';

const BASE = '/api/v2';

function createWrapper(): { wrapper: ({ children }: { children: ReactNode }) => ReactNode; client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper, client };
}

afterEach(() => {
  resetGeneratedClient();
});

describe('useNotificationsList', () => {
  it('fetches and normalizes the page envelope', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.get(`${BASE}/notifications/notifications/prompt_lib/7`, () =>
        HttpResponse.json({
          rows: [{ id: 1, event_type: 'rates', created_at: '2026-01-01T00:00:00Z', is_seen: false }],
          total: 1,
        }),
      ),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useNotificationsList({ projectId: 7 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1);
    // Normalization ran: camelCase field, not the wire's snake_case.
    expect(result.current.data?.rows[0]?.isSeen).toBe(false);
    expect(result.current.data?.rows[0]?.id).toBe('1');
  });

  it('does not fire the request while disabled', () => {
    configureGeneratedClient({ baseUrl: BASE });
    let hit = false;
    server.use(
      http.get(`${BASE}/notifications/notifications/prompt_lib/7`, () => {
        hit = true;
        return HttpResponse.json({ rows: [], total: 0 });
      }),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useNotificationsList({ projectId: 7 }, { enabled: false }), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(hit).toBe(false);
  });
});

describe('useBulkMarkSeenNotifications', () => {
  it('invalidates the notifications query root on success', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.put(`${BASE}/notifications/notifications/prompt_lib/7`, () => HttpResponse.json({})));
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useBulkMarkSeenNotifications(), { wrapper });
    result.current.mutate({ projectId: 7, ids: ['1'], isSeen: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: NOTIFICATIONS_QUERY_ROOT });
  });

  it('rejects the promise on a 500, surfacing an EliteaApiError', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.put(`${BASE}/notifications/notifications/prompt_lib/7`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBulkMarkSeenNotifications(), { wrapper });
    result.current.mutate({ projectId: 7, ids: ['1'], isSeen: true });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useBulkDeleteNotifications', () => {
  it('invalidates the notifications query root on success', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.delete(`${BASE}/notifications/notifications/prompt_lib/7`, () => HttpResponse.json({})));
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useBulkDeleteNotifications(), { wrapper });
    result.current.mutate({ projectId: 7, ids: ['1', '2'] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: NOTIFICATIONS_QUERY_ROOT });
  });
});

describe('useReadNotification / useDeleteNotification (no baseline UI call site — parity only)', () => {
  it('useReadNotification PUTs and invalidates', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.put(`${BASE}/notifications/notification/prompt_lib/7/1`, () => HttpResponse.json({})));
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useReadNotification(), { wrapper });
    result.current.mutate({ projectId: 7, id: 1 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: NOTIFICATIONS_QUERY_ROOT });
  });

  it('useDeleteNotification DELETEs and invalidates', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.delete(`${BASE}/notifications/notification/prompt_lib/7/1`, () => HttpResponse.json({})));
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteNotification(), { wrapper });
    result.current.mutate({ projectId: 7, id: 1 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: NOTIFICATIONS_QUERY_ROOT });
  });
});
