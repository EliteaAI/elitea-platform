import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { server } from '@/test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { useChatEntityBrowser } from './useChatEntityBrowser';

const BASE = '/api/v2';

function createWrapper(): { wrapper: ({ children }: { children: ReactNode }) => ReactNode } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper };
}

function applicationRow(id: string, agentsType: string | null) {
  return {
    id,
    name: agentsType === 'pipeline' ? 'A Pipeline' : 'An Agent',
    created_at: 't',
    updated_at: 't',
    owner_id: 'u',
    is_forked: false,
    meta: null,
    has_interrupt: false,
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
  server.use(
    http.get(`${BASE}/elitea_core/applications/prompt_lib/7`, ({ request }) => {
      const agentsType = new URL(request.url).searchParams.get('agents_type');
      return HttpResponse.json({ rows: [applicationRow(agentsType === 'pipeline' ? 'p1' : 'a1', agentsType)], total: 1 });
    }),
    http.get(`${BASE}/elitea_core/public_applications/prompt_lib`, () => HttpResponse.json({ rows: [], total: 0 })),
    http.get(`${BASE}/elitea_core/tools/prompt_lib/7`, () =>
      HttpResponse.json({
        rows: [
          { id: 'tk-1', type: 'github', name: 'Github', description: '', settings: {}, meta: {}, created_at: 't', author_id: 1 },
          { id: 'tk-2', type: 'mcp_custom', name: 'My MCP', description: '', settings: {}, meta: {}, created_at: 't', author_id: 1 },
        ],
        total: 2,
      }),
    ),
    http.get(`${BASE}/elitea_core/tools/prompt_lib/1`, () => HttpResponse.json({ rows: [], total: 0 })),
  );
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useChatEntityBrowser', () => {
  it('splits applications into agents/pipelines buckets by participantType', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useChatEntityBrowser({ projectId: '7', publicProjectId: '1', canListPublicAgents: false }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.agents.isFetching).toBe(false));
    await waitFor(() => expect(result.current.pipelines.isFetching).toBe(false));

    expect(result.current.agents.items.map((i) => i.data['id'])).toEqual(['a1']);
    expect(result.current.pipelines.items.map((i) => i.data['id'])).toEqual(['p1']);
  });

  it('splits toolkits into toolkits/mcps buckets by the mcp type predicate', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useChatEntityBrowser({ projectId: '7', publicProjectId: '1', canListPublicAgents: false }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.toolkits.isFetching).toBe(false));
    await waitFor(() => expect(result.current.mcps.isFetching).toBe(false));

    expect(result.current.toolkits.items.map((i) => i.data['id'])).toEqual(['tk-1']);
    expect(result.current.mcps.items.map((i) => i.data['id'])).toEqual(['tk-2']);
  });

  it('skip disables every fetch', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useChatEntityBrowser({ projectId: '7', publicProjectId: '1', canListPublicAgents: false, skip: true }),
      { wrapper },
    );

    expect(result.current.agents.items).toEqual([]);
    expect(result.current.toolkits.items).toEqual([]);
    expect(result.current.mcps.items).toEqual([]);
  });
});
