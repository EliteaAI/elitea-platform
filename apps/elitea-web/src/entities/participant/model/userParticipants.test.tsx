import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { server } from '@/test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { useUserParticipants } from './userParticipants';

const BASE = '/api/v2';

function createWrapper(): { wrapper: ({ children }: { children: ReactNode }) => ReactNode } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useUserParticipants', () => {
  it('fetches the one unpaginated page and filters client-side by name/email', async () => {
    server.use(
      http.get(`${BASE}/admin/users/default/7`, () =>
        HttpResponse.json({
          rows: [
            { id: '1', email: 'alice@example.com', name: 'Alice', roles: [] },
            { id: '2', email: 'bob@example.com', name: 'Bob', roles: [] },
          ],
          total: 2,
        }),
      ),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUserParticipants({ projectId: '7', query: 'ali' }), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(1));
    expect(result.current.rows.map((r) => r.name)).toEqual(['Alice']);
  });

  it('stays disabled when projectId is undefined', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUserParticipants({ projectId: undefined }), { wrapper });
    expect(result.current.isFetching).toBe(false);
  });
});
