import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { useServicePromptByKey } from './useServicePromptByKey';

const BASE = '/api/v2';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  resetGeneratedClient();
});

describe('useServicePromptByKey', () => {
  it('is disabled (no network call) when key is null', () => {
    configureGeneratedClient({ baseUrl: BASE });
    let called = false;
    server.use(
      http.get(`${BASE}/configurations/configurations/7`, () => {
        called = true;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );

    const { result } = renderHook(() => useServicePromptByKey(7, null), { wrapper: createWrapper() });

    expect(result.current.prompt).toBe('');
    expect(called).toBe(false);
  });

  it('finds the config matching data.key and exposes its prompt text', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.get(`${BASE}/configurations/configurations/7`, () =>
        HttpResponse.json({
          items: [
            { type: 'service_prompt', data: { key: 'llm_task_assistant', prompt: 'Write a task message.' } },
            { type: 'service_prompt', data: { key: 'other_key', prompt: 'unrelated' } },
          ],
          total: 2,
        }),
      ),
    );

    const { result } = renderHook(() => useServicePromptByKey(7, 'llm_task_assistant'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.prompt).toBe('Write a task message.'));
    expect(result.current.config?.data?.key).toBe('llm_task_assistant');
  });

  it('falls back to matching by elitea_title when no data.key matches', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.get(`${BASE}/configurations/configurations/7`, () =>
        HttpResponse.json({
          items: [{ type: 'service_prompt', elitea_title: 'code_assistant', data: { prompt: 'Improve this code.' } }],
          total: 1,
        }),
      ),
    );

    const { result } = renderHook(() => useServicePromptByKey(7, 'code_assistant'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.prompt).toBe('Improve this code.'));
  });

  it('also searches the shared sub-page', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.get(`${BASE}/configurations/configurations/7`, () =>
        HttpResponse.json({
          items: [],
          total: 0,
          shared: { items: [{ type: 'service_prompt', data: { key: 'router_assistant', prompt: 'Route this.' } }], total: 1 },
        }),
      ),
    );

    const { result } = renderHook(() => useServicePromptByKey(7, 'router_assistant'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.prompt).toBe('Route this.'));
  });

  it('returns an empty prompt and null config when nothing matches', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/configurations/7`, () => HttpResponse.json({ items: [], total: 0 })));

    const { result } = renderHook(() => useServicePromptByKey(7, 'not_configured_yet'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.prompt).toBe('');
    expect(result.current.config).toBeNull();
  });
});
