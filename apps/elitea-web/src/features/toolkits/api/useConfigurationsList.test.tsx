import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useConfigurationsList } from './useConfigurationsList';

const BASE = '/api/v2';

function createWrapper(): { wrapper: ({ children }: { children: ReactNode }) => ReactNode } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper };
}

afterEach(() => {
  resetGeneratedClient();
});

describe('useConfigurationsList', () => {
  it('fetches and resolves the page envelope', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.get(`${BASE}/configurations/configurations/p1`, () =>
        HttpResponse.json({ items: [{ type: 'sharepoint' }], total: 1, limit: 20, offset: 0 }),
      ),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConfigurationsList({ projectId: 'p1', section: 'credentials' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1);
  });

  it('does not fire the request while disabled', () => {
    configureGeneratedClient({ baseUrl: BASE });
    let hit = false;
    server.use(
      http.get(`${BASE}/configurations/configurations/p1`, () => {
        hit = true;
        return HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0 });
      }),
    );
    const { wrapper } = createWrapper();
    renderHook(() => useConfigurationsList({ projectId: 'p1' }, { enabled: false }), { wrapper });
    expect(hit).toBe(false);
  });
});
