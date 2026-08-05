import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useToolkitDetail } from './useToolkitDetail';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useToolkitDetail', () => {
  it('finds the matching row inside the real list response by id', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () =>
        HttpResponse.json({
          rows: [
            { id: 'tk-1', type: 'github', name: 'a', description: '', settings: {}, meta: {}, created_at: '2026-01-01T00:00:00Z', author_id: 1 },
            { id: 'tk-2', type: 'jira', name: 'b', description: '', settings: {}, meta: {}, created_at: '2026-01-01T00:00:00Z', author_id: 1 },
          ],
          total: 2,
        }),
      ),
    );

    const { result } = renderHook(() => useToolkitDetail('proj-1', 'tk-2'), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.detail?.id).toBe('tk-2');
    expect(result.current.detail?.type).toBe('jira');
    expect(result.current.isError).toBe(false);
  });

  it('resolves undefined when no row matches the requested id', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () =>
        HttpResponse.json({ rows: [{ id: 'tk-1', type: 'github', name: 'a', description: '', settings: {}, meta: {}, created_at: '2026-01-01T00:00:00Z', author_id: 1 }], total: 1 }),
      ),
    );

    const { result } = renderHook(() => useToolkitDetail('proj-1', 'missing'), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.detail).toBeUndefined();
  });

  it('does not fetch while projectId or toolkitId is undefined', () => {
    const { result } = renderHook(() => useToolkitDetail(undefined, 'tk-1'), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.detail).toBeUndefined();
  });
});
