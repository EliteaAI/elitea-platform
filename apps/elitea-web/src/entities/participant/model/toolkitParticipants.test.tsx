import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { server } from '@/test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { toolkitCandidateDisplayName, useToolkitParticipants } from './toolkitParticipants';

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

function toolkitRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tk-1',
    type: 'github',
    name: 'Github',
    description: '',
    settings: {},
    meta: {},
    created_at: 't',
    author_id: 1,
    ...overrides,
  };
}

describe('useToolkitParticipants', () => {
  it('splits toolkits vs. MCPs client-side via isMcpToolkit, and paginates limit/offset for real', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/tools/prompt_lib/7`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('offset') === '100') {
          return HttpResponse.json({ rows: [toolkitRow({ id: 'tk-2', name: 'Second Page' })], total: 3 });
        }
        return HttpResponse.json({
          rows: [toolkitRow({ id: 'tk-1', name: 'Github', type: 'github' }), toolkitRow({ id: 'mcp-1', name: 'MCP Server', type: 'mcp' })],
          total: 3,
        });
      }),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useToolkitParticipants({ projectId: '7' }), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(3));
    expect(result.current.toolkits.map((t) => t.id)).toEqual(['tk-1']);
    expect(result.current.mcps.map((t) => t.id)).toEqual(['mcp-1']);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.toolkits.map((t) => t.id)).toEqual(['tk-2']));
  });

  it('filters both buckets by query client-side via toolkitDisplayName', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/tools/prompt_lib/7`, () =>
        HttpResponse.json({ rows: [toolkitRow({ id: 'tk-1', name: 'Github' }), toolkitRow({ id: 'tk-2', name: 'Jira' })], total: 2 }),
      ),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useToolkitParticipants({ projectId: '7', query: 'git' }), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(2));
    expect(result.current.toolkits.map((t) => t.id)).toEqual(['tk-1']);
  });
});

describe('toolkitCandidateDisplayName', () => {
  /**
   * Regression test: this function is a deliberate duplicate of
   * `entities/toolkit/model/selectors.ts`'s `toolkitDisplayName` (see this
   * file's own header). That canonical version's fallback chain is
   * name -> raw toolkit_name field -> settings.elitea_title ->
   * settings.configuration_title -> capitalized type. This duplicate
   * originally skipped the toolkit_name step, so a toolkit with an empty
   * `name` but a real raw `toolkit_name` field fell straight through to
   * elitea_title/configuration_title/type instead — found by adversarial
   * verify against the canonical function's real behaviour.
   */
  it('falls back through toolkit_name before settings.elitea_title, matching entities/toolkit’s toolkitDisplayName', () => {
    expect(
      toolkitCandidateDisplayName({
        id: 't1',
        name: '',
        type: 'github',
        toolkit_name: 'Raw Toolkit Name',
        settings: { elitea_title: 'Elitea Title' },
      }),
    ).toBe('Raw Toolkit Name');
  });

  it('falls back to settings.elitea_title when both name and toolkit_name are empty', () => {
    expect(
      toolkitCandidateDisplayName({
        id: 't1',
        name: '',
        type: 'github',
        toolkit_name: '',
        settings: { elitea_title: 'Elitea Title' },
      }),
    ).toBe('Elitea Title');
  });
});
