/**
 * The fetcher typed `eliteaFetch<SupportAssistantConfig>` and returned the
 * result verbatim — i.e. the `{data,status,headers}` envelope typed as the
 * body — so `enabled` was permanently `undefined` and the assistant read as
 * off for everyone, with a 200 and nothing in the console. Same defect shape
 * as the blank PAT in issue #132; there was no test on this module at all.
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useGetSupportAssistantConfigQuery } from './supportAssistantConfigApi';

const BASE = '/api/v2';

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useGetSupportAssistantConfigQuery', () => {
  it.each([true, false])('exposes the server\'s enabled flag (%s) from the response BODY', async (enabled) => {
    server.use(http.get(`${BASE}/support_assistant/config/`, () => HttpResponse.json({ enabled })));

    const { result } = renderHook(() => useGetSupportAssistantConfigQuery(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.enabled).toBe(enabled);
  });
});
