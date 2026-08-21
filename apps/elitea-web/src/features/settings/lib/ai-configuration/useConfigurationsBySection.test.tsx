/**
 * useConfigurationsBySection.test.tsx
 *
 * DEFECT this file pins: the combiner read only `q.data?.items` and put `[]`
 * in place of anything else, and it returned no error channel. Seven failed
 * section queries produced the same all-empty record as seven empty ones, so
 * a 403 reached the AI-Configuration page as "you have no LLM configurations".
 * A user with a working credential saw that credential disappear.
 * Evidence: `GET /api/v2/configurations/configurations/1?section=llm` answers
 * `403 {"error":"insufficient permissions"}` on a live deployment.
 *
 * A second route into the same false-empty state: with an unresolved project
 * id, `enabled: !!projectId` stops every query, `isFetching` is false, and the
 * old code reported the all-empty record as a settled success.
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { EliteaApiError, configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../../test/setup';

import { useConfigurationsBySection } from './useConfigurationsBySection';

const BASE = '/api/v2';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  resetGeneratedClient();
});

describe('useConfigurationsBySection', () => {
  it('reports a refused section as an error, not as an empty project', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.get(`${BASE}/configurations/configurations/1`, () =>
        HttpResponse.json({ error: 'insufficient permissions' }, { status: 403 }),
      ),
    );

    const { result } = renderHook(() => useConfigurationsBySection('1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(EliteaApiError);
    // `data: null` is what stops the page rendering the empty state.
    expect(result.current.data).toBeNull();
  });

  it('builds the section record when every section resolves', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.get(`${BASE}/configurations/configurations/1`, ({ request }) => {
        const section = new URL(request.url).searchParams.get('section');
        const items = section === 'llm'
          ? [{ id: 1, project_id: '1', elitea_title: 'OpenAI', label: 'openai', type: 'openai', section: 'llm', shared: false, data: {} }]
          : [];
        return HttpResponse.json({ items, total: items.length, offset: 0, limit: 200 });
      }),
    );

    const { result } = renderHook(() => useConfigurationsBySection('1'), { wrapper });

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.data?.llm).toHaveLength(1);
    expect(result.current.data?.embedding).toEqual([]);
  });

  it('stays loading while the project id is unresolved instead of reporting an empty record', () => {
    configureGeneratedClient({ baseUrl: BASE });

    const { result } = renderHook(() => useConfigurationsBySection(''), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
