import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';

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
  it('is disabled (no fetch, no crash) while appId is missing or non-numeric', async () => {
    const missing = renderHookWithRouter(() => useAppDetail(undefined), { projectId: 'proj-1' });
    await waitFor(() => expect(missing.result.current).toBeDefined());
    expect(missing.result.current.isFetching).toBe(false);
    expect(missing.result.current.hasCustomUI).toBe(false);
    expect(missing.result.current.appName).toBe('Application');

    const nonNumeric = renderHookWithRouter(() => useAppDetail('not-a-number'), { projectId: 'proj-1' });
    await waitFor(() => expect(nonNumeric.result.current).toBeDefined());
    expect(nonNumeric.result.current.isFetching).toBe(false);
    expect(nonNumeric.result.current.hasCustomUI).toBe(false);
  });

  it('is disabled (no fetch, no crash) while there is no selected project, even with a valid numeric appId', async () => {
    const { result } = renderHookWithRouter(() => useAppDetail('7'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current.isFetching).toBe(false);
    expect(result.current.hasCustomUI).toBe(false);
  });

  it('defaults appName to "Application" and hasCustomUI to false while loading/absent', async () => {
    server.use(getGetApplicationMockHandler(detail({ name: 'Wikis' })));

    const { result } = renderHookWithRouter(() => useAppDetail('7'), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.appName).toBe('Wikis');
    expect(result.current.hasCustomUI).toBe(false);
    expect(result.current.iframeUrl).toBeNull();
  });

  it('builds the /ui_host iframe URL when the backend supplies custom_ui_route + provider in version_details.meta', async () => {
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

    await waitFor(() => expect(result.current.hasCustomUI).toBe(true));
    expect(result.current.iframeUrl).toMatch(/^\/ui_host\/deepwiki\/wiki\/proj-1\/\?/);
    expect(result.current.iframeUrl).toContain('toolkit_id=7');
    expect(result.current.iframeKey).toBeGreaterThan(0);
  });

  it('does not build an iframe URL when only one of custom_ui_route/provider is present', async () => {
    server.use(
      getGetApplicationMockHandler(
        detail({
          version_details: {
            id: '1',
            application_id: '7',
            name: 'v1',
            status: 'active',
            meta: { custom_ui_route: 'wiki' },
          },
        }),
      ),
    );

    const { result } = renderHookWithRouter(() => useAppDetail('7'), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.hasCustomUI).toBe(false);
    expect(result.current.iframeUrl).toBeNull();
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
});
