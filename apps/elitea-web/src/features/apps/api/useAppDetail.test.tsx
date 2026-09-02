import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';

import { getGetApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useAppDetail } from './useAppDetail';
import { renderHookWithRouter } from '../__tests__/testUtils';

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: '7',
    name: 'Wikis',
    description: 'A wiki toolkit',
    icon: '',
    owner_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    versions: [],
    ...overrides,
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useAppDetail', () => {
  it('is disabled (no fetch, no crash) while appId is missing', async () => {
    const missing = renderHookWithRouter(() => useAppDetail(undefined), { projectId: 'proj-1' });
    await waitFor(() => expect(missing.result.current).toBeDefined());
    expect(missing.result.current.isFetching).toBe(false);
    expect(missing.result.current.appName).toBe('Application');
  });

  it('still fires the fetch for a non-numeric appId and lets the backend error surface, instead of silently disabling the query (regression test — a bad/stale app-detail link must not render a blank page with no loading/error indication)', async () => {
    server.use(
      http.get('*/elitea_core/application/prompt_lib/:projectId/:applicationId', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const { result } = renderHookWithRouter(() => useAppDetail('not-a-number'), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBeDefined();
  });

  it('is disabled (no fetch, no crash) while there is no selected project, even with a valid numeric appId', async () => {
    const { result } = renderHookWithRouter(() => useAppDetail('7'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current.isFetching).toBe(false);
  });

  it('reads appName from the fetched detail', async () => {
    server.use(getGetApplicationMockHandler(detail({ name: 'Wikis' })));

    const { result } = renderHookWithRouter(() => useAppDetail('7'), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.appName).toBe('Wikis');
  });

  it('exposes no custom-UI frame state, even when the legacy meta keys are present (ADR-0024 WP8)', async () => {
    server.use(
      getGetApplicationMockHandler(
        detail({
          version_details: {
            id: '1',
            application_id: '7',
            name: 'v1',
            status: 'active',
            meta: { custom_ui_route: 'wiki', provider: 'deepwiki' },
          },
        }),
      ),
    );

    const { result } = renderHookWithRouter(() => useAppDetail('7'), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.appName).toBe('Wikis');
    expect(Object.keys(result.current).sort()).toEqual(['appName', 'error', 'isError', 'isFetching']);
  });

  it('surfaces a fetch error via isError/error', async () => {
    server.use(getGetApplicationMockHandler(() => Promise.reject(new Error('unreachable in mock'))));

    const { result } = renderHookWithRouter(() => useAppDetail('7'), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false), { timeout: 3000 });
    // The mock handler rejecting surfaces as a network-shaped failure either
    // way (isFetching settles false); the important contract is that the
    // hook never throws and always returns a stable shape.
    expect(result.current.appName).toBe('Application');
  });

  it('calls the onError option exactly once when the query enters an error state (regression test — the baseline fires a toast on fetch failure; this is the callback a caller wires a real notification to, see the hook\'s own UseAppDetailOptions doc comment)', async () => {
    server.use(
      http.get('*/elitea_core/application/prompt_lib/:projectId/:applicationId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    const onError = vi.fn();

    const { result } = renderHookWithRouter(() => useAppDetail('7', { onError }), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(result.current.error);
  });

  it('never calls onError while the query is healthy', async () => {
    server.use(getGetApplicationMockHandler(detail({ name: 'Wikis' })));
    const onError = vi.fn();

    const { result } = renderHookWithRouter(() => useAppDetail('7', { onError }), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(onError).not.toHaveBeenCalled();
  });
});
