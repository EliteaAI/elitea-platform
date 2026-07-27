import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext, RouterContext } from '@/app/router-context';
import { resetConfigForTests } from '@/shared/config/get-config';

import { routeTree } from '../../routeTree.gen';

beforeEach(() => {
  resetConfigForTests();
  vi.stubEnv('VITE_SERVER_URL', 'https://elitea.example');
  vi.stubEnv('VITE_BASE_URI', '/app/');
  vi.stubEnv('VITE_PUBLIC_PROJECT_ID', '11');
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

/**
 * Full-router integration companion to `guards.test.ts`'s pure-function
 * proofs: mounts the REAL generated route tree with a REAL `RouterProvider`
 * (no mocking of the router — §6.2) and asserts the guard actually changes
 * where navigation lands, not just that the isolated function would redirect.
 */
function mountAt(path: string, auth: AuthContext) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history, context: { auth } satisfies RouterContext });
  render(<RouterProvider router={router} />);
  return router;
}

describe('SkillsGuard (full router)', () => {
  it('RED/GREEN (b): a public-project user navigating to /skills/all is redirected to /chat before it renders', async () => {
    const router = mountAt('/skills/all', {
      getUser: () => ({ id: 'u1', permissions: ['models.chat.folders.get'] }),
      getSelectedProjectId: () => '11', // matches VITE_PUBLIC_PROJECT_ID in default test env
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chat');
    });
    expect(screen.queryByTestId('route-shell')).toHaveAttribute('data-route-id', 'chat');
  });

  it('a non-public-project user navigating to /skills/all renders the skills tab list, not a redirect', async () => {
    const router = mountAt('/skills/all', {
      getUser: () => ({ id: 'u1', permissions: ['models.chat.folders.get'] }),
      getSelectedProjectId: () => '999',
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-shell')).toHaveAttribute('data-route-id', 'skills.tab');
    });
    expect(router.state.location.pathname).toBe('/skills/all');
  });
});

describe('IndexRoute (full router)', () => {
  it('renders the loading state at "/" while user.id is not yet known (no redirect fires)', async () => {
    const router = mountAt('/', {
      getUser: () => undefined,
      getSelectedProjectId: () => undefined,
    });

    await waitFor(() => {
      expect(router.state.status).toBe('idle');
    });
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
