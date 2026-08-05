import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useConfigurationsAsSchema } from './useConfigurationsAsSchema.hooks';

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

describe('useConfigurationsAsSchema', () => {
  it('fetches the available-configurations-type catalogue', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([{ type: 'sharepoint', config_schema: {} }])));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConfigurationsAsSchema(), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.configurationsAsSchema).toEqual([{ type: 'sharepoint', config_schema: {} }]);
  });

  it('does not fire the request when skip is true', () => {
    configureGeneratedClient({ baseUrl: BASE });
    let hit = false;
    server.use(
      http.get(`${BASE}/configurations/available/`, () => {
        hit = true;
        return HttpResponse.json([]);
      }),
    );
    const { wrapper } = createWrapper();
    renderHook(() => useConfigurationsAsSchema({ skip: true }), { wrapper });
    expect(hit).toBe(false);
  });
});
