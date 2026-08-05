import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { getGetAgentCategoriesMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';

import { server } from '../../test/setup';

import { useAgentHubData } from './useAgentHubData';

const globals = globalThis as unknown as Record<string, unknown>;

function setConfig(publicProjectId: string): void {
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example',
    vite_base_uri: '/',
    vite_public_project_id: publicProjectId,
  };
  resetConfigForTests();
}

/** `useGetAgentCategories` (the generated `useQuery` hook) needs a `QueryClientProvider` ancestor. */
function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function mockBulkList(rows: unknown[]): void {
  server.use(
    http.get('*/elitea_core/public_applications/prompt_lib', () =>
      HttpResponse.json({ data: { rows, total: rows.length } }, { status: 200 }),
    ),
  );
}

describe('useAgentHubData', () => {
  afterEach(() => {
    delete globals['elitea_ui_config'];
    resetConfigForTests();
    resetGeneratedClient();
  });

  it('fetches agent_categories for the configured VITE_PUBLIC_PROJECT_ID, not a hardcoded "1" (adversarial-review fix, cluster A13-agents-hub, finding 7)', async () => {
    setConfig('77');
    configureGeneratedClient({ baseUrl: '/api/v2' });
    let requestedProjectId: string | undefined;
    server.use(
      http.get('*/elitea_core/agent_categories/prompt_lib/:projectId', ({ params }) => {
        requestedProjectId = params['projectId'] as string;
        return HttpResponse.json({ categories: [{ name: 'Productivity', is_default: true }], total: 1 });
      }),
    );
    mockBulkList([]);

    renderHook(() => useAgentHubData([]), { wrapper });

    await waitFor(() => expect(requestedProjectId).toBe('77'));
  });

  it('buckets fetched agents by meta.category (adversarial-review fix, cluster A13-agents-hub, finding 4, exercised end-to-end through this hook)', async () => {
    setConfig('1');
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getGetAgentCategoriesMockHandler({ categories: [{ name: 'Productivity', is_default: true }], total: 1 }));
    mockBulkList([
      {
        project_id: '1',
        id: 'app-1',
        name: 'Research Agent',
        description: '',
        version_id: 'v-1',
        version_name: 'v1',
        agent_type: 'agent',
        meta: { category: 'Productivity' },
      },
    ]);

    const { result } = renderHook(() => useAgentHubData([]), { wrapper });

    await waitFor(() => expect(result.current.applicationsByTag['Productivity']).toHaveLength(1));
    expect(result.current.applicationsByTag['Productivity']?.[0]?.id).toBe('app-1');
  });

  it('still sends sort_by=likes/sort_order=desc for the Trending bucket and my_liked=true for My Liked (forward-compat with the disclosed backend gap — findings 5 & 6)', async () => {
    setConfig('1');
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getGetAgentCategoriesMockHandler({ categories: [{ name: 'Productivity', is_default: true }], total: 1 }));

    const seenQueries: string[] = [];
    server.use(
      http.get('*/elitea_core/public_applications/prompt_lib', ({ request }) => {
        seenQueries.push(new URL(request.url).search);
        return HttpResponse.json({ data: { rows: [], total: 0 } }, { status: 200 });
      }),
    );

    renderHook(() => useAgentHubData([]), { wrapper });

    await waitFor(() => expect(seenQueries.length).toBeGreaterThanOrEqual(3));
    expect(seenQueries.some(q => q.includes('sort_by=likes') && q.includes('sort_order=desc'))).toBe(true);
    expect(seenQueries.some(q => q.includes('my_liked=true'))).toBe(true);
  });

  it('filters applicationsByTag down to only the selected tag names when any are selected', async () => {
    setConfig('1');
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(
      getGetAgentCategoriesMockHandler({
        categories: [
          { name: 'Productivity', is_default: true },
          { name: 'Support', is_default: true },
        ],
        total: 2,
      }),
    );
    mockBulkList([
      {
        project_id: '1',
        id: 'app-1',
        name: 'Research Agent',
        description: '',
        version_id: 'v-1',
        version_name: 'v1',
        agent_type: 'agent',
        meta: { category: 'Productivity' },
      },
      {
        project_id: '1',
        id: 'app-2',
        name: 'Support Bot',
        description: '',
        version_id: 'v-2',
        version_name: 'v1',
        agent_type: 'agent',
        meta: { category: 'Support' },
      },
    ]);

    const { result, rerender } = renderHook(({ tags }: { tags: string[] }) => useAgentHubData(tags), {
      initialProps: { tags: [] as string[] },
      wrapper,
    });

    await waitFor(() => expect(Object.keys(result.current.applicationsByTag).length).toBeGreaterThan(0));

    rerender({ tags: ['Support'] });

    await act(async () => {});
    expect(result.current.applicationsByTag['Support']).toBeDefined();
    expect(result.current.applicationsByTag['Productivity']).toBeUndefined();
  });
});
