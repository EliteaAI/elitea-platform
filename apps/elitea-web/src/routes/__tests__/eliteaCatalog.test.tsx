/**
 * `/agents-hub` is a redirect source, `/elitea-catalog` is the page.
 *
 * Mounted through the REAL generated route tree (same harness as
 * `allRoutesSmoke.test.tsx`), because the thing under test is the route
 * wiring itself: a redirect that drops the query string still "settles to
 * idle", and the smoke test would call that a pass. The shared `?agentId=`
 * deep link is the only link shape that reaches `/agents-hub` in the wild,
 * so losing the search string is the whole defect.
 */
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext, RouterContext } from '@/app/router-context';
import { resetConfigForTests } from '@/shared/config/get-config';

import { routeTree } from '../../routeTree.gen';

const permissiveAuth: AuthContext = {
  getUser: () => ({
    id: 'u1',
    personal_project_id: 'p1',
    permissions: [],
    publicPermissions: [],
  }),
  getSelectedProjectId: () => '999',
};

async function loadAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { auth: permissiveAuth } satisfies RouterContext,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(router.state.status).toBe('idle');
  });
  return router;
}

beforeEach(() => {
  resetConfigForTests();
  vi.stubEnv('VITE_SERVER_URL', 'https://elitea.example');
  vi.stubEnv('VITE_BASE_URI', '/app/');
  vi.stubEnv('VITE_PUBLIC_PROJECT_ID', '11');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe('/elitea-catalog', () => {
  it('mounts the catalogue page', async () => {
    const router = await loadAt('/elitea-catalog');
    expect(router.state.location.pathname).toBe('/elitea-catalog');
    const errored = (router.state.matches as { status?: string }[]).find((match) => match.status === 'error');
    expect(errored).toBeUndefined();
  });

  it('keeps ?tab=skills through validation', async () => {
    const router = await loadAt('/elitea-catalog?tab=skills');
    expect((router.state.location.search as { tab?: string }).tab).toBe('skills');
  });
});

describe('/agents-hub redirects to the catalogue', () => {
  it('lands on /elitea-catalog', async () => {
    const router = await loadAt('/agents-hub');
    expect(router.state.location.pathname).toBe('/elitea-catalog');
  });

  it('preserves the ?agentId= deep link across the redirect', async () => {
    const router = await loadAt('/agents-hub?agentId=app-1');
    expect(router.state.location.pathname).toBe('/elitea-catalog');
    expect((router.state.location.search as { agentId?: string }).agentId).toBe('app-1');
  });

  it('preserves ?tab= across the redirect', async () => {
    const router = await loadAt('/agents-hub?tab=skills');
    // Both halves asserted: an un-redirected `/agents-hub` that merely kept
    // the query string would satisfy the search assertion on its own.
    expect(router.state.location.pathname).toBe('/elitea-catalog');
    expect((router.state.location.search as { tab?: string }).tab).toBe('skills');
  });
});
