import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { server } from '@/test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { useParticipants } from './useParticipants';

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
  server.use(
    http.get(`${BASE}/elitea_core/applications/prompt_lib/7`, ({ request }) => {
      const url = new URL(request.url);
      const agentsType = url.searchParams.get('agents_type');
      const row = {
        id: agentsType,
        name: agentsType === 'pipeline' ? 'A Pipeline' : 'An Agent',
        created_at: 't',
        updated_at: 't',
        owner_id: 'u',
        is_forked: false,
        meta: null,
        has_interrupt: false,
      };
      return HttpResponse.json({ rows: [row], total: 1, page: 1, page_size: 20, total_pages: 1 });
    }),
    http.get(`${BASE}/elitea_core/public_applications/prompt_lib`, () => HttpResponse.json({ rows: [], total: 0 })),
    http.get(`${BASE}/elitea_core/tools/prompt_lib/7`, () => HttpResponse.json({ rows: [{ id: 'tk-1', type: 'github', name: 'Github', description: '', settings: {}, meta: {}, created_at: 't', author_id: 1 }], total: 1 })),
    http.get(`${BASE}/elitea_core/tools/prompt_lib/1`, () => HttpResponse.json({ rows: [], total: 0 })),
    http.get(`${BASE}/admin/users/default/7`, () => HttpResponse.json({ rows: [{ id: 'u1', email: 'u1@example.com', name: 'User One', roles: [] }], total: 1 })),
  );
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useParticipants', () => {
  it('with an empty types array, includes applications/pipelines but NOT toolkits/users (documented fetch-gating quirk)', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useParticipants({
          projectId: '7',
          publicProjectId: '1',
          canListPublicAgents: false,
          types: [],
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    const kinds = result.current.participants.map((p) => p.participantType).sort();
    expect(kinds).toEqual(['application', 'pipeline']);
  });

  it('explicitly requesting "toolkit"/"user" types fetches and includes them', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useParticipants({
          projectId: '7',
          publicProjectId: '1',
          canListPublicAgents: false,
          types: ['toolkit', 'user'],
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    const kinds = result.current.participants.map((p) => p.participantType).sort();
    expect(kinds).toEqual(['toolkit', 'user']);
  });
});
