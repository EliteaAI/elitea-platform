import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { server } from '@/test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { usePrivateApplicationParticipants, usePublicApplicationParticipants } from './applicationParticipants';

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

describe('usePrivateApplicationParticipants', () => {
  it('sends agents_type + query and returns rows/total from the envelope', async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.get(`${BASE}/elitea_core/applications/prompt_lib/7`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ rows: [{ id: 'a1', name: 'Agent', created_at: 't', updated_at: 't', owner_id: 'u', is_forked: false, meta: null, has_interrupt: false }], total: 1, page: 1, page_size: 20, total_pages: 1 });
      }),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => usePrivateApplicationParticipants({ projectId: '7', agentsType: 'classic', query: 'agent' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.total).toBe(1));
    expect(capturedUrl).toContain('agents_type=classic');
    expect(capturedUrl).toContain('query=agent');
    expect(result.current.rows).toHaveLength(1);
  });

  it('stays disabled when projectId is undefined', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => usePrivateApplicationParticipants({ projectId: undefined, agentsType: 'classic' }),
      { wrapper },
    );
    expect(result.current.isFetching).toBe(false);
    expect(result.current.rows).toEqual([]);
  });
});

describe('usePublicApplicationParticipants', () => {
  it('splits classic vs. pipeline client-side by agent_type, and filters by query client-side', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/public_applications/prompt_lib`, () =>
        HttpResponse.json({
          rows: [
            { project_id: '1', id: 'p1', name: 'Public Agent', description: '', version_id: 'v', version_name: 'v', agent_type: 'classic', meta: null },
            { project_id: '1', id: 'p2', name: 'Public Pipeline', description: '', version_id: 'v', version_name: 'v', agent_type: 'pipeline', meta: null },
          ],
          total: 2,
        }),
      ),
    );
    const { wrapper } = createWrapper();
    const { result: classic } = renderHook(() => usePublicApplicationParticipants({ agentsType: 'classic' }), { wrapper });
    await waitFor(() => expect(classic.current.total).toBe(1));
    expect(classic.current.rows.map((r) => r.name)).toEqual(['Public Agent']);

    const { result: pipeline } = renderHook(() => usePublicApplicationParticipants({ agentsType: 'pipeline' }), { wrapper });
    await waitFor(() => expect(pipeline.current.total).toBe(1));
    expect(pipeline.current.rows.map((r) => r.name)).toEqual(['Public Pipeline']);
  });
});
