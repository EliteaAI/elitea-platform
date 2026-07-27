import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { server } from '@/test/setup';
import { resetConfigForTests } from '@/shared/config/get-config';
import { authorGated } from '@/test/msw/handlers/transport';
import { installWebStorageShim } from '@/test/webstorage';

import { routeTree } from '../routeTree.gen';
import { stubAuthContext } from '@/app/router-context';

// F4's documented gap (shared/api/auth/callback.ts's `sendAuthResult` writes
// to localStorage; under vitest 4 + Node 24 `window.localStorage` is
// `undefined` in the node project until this shim installs one — see
// `src/test/webstorage.ts`'s header, "action for M1", not yet wired into
// the shared `src/test/setup.ts`). Per-file import until it is.
installWebStorageShim();

/**
 * ROUTE-001 `/auth-callback` (spec §8.1; §5.4 behaviour 5). Exercises the
 * REAL route mounted through a REAL router at `/auth-callback?auth_state=`,
 * against unit F4's own `authorGated` MSW fixture for
 * `GET /api/v2/social/author/` (the auth/me-class session probe
 * `createVerifySession` binds to) — no mocking of F4's `completeAuthCallback`
 * itself (§6.2: mocks stop at the network boundary).
 */
function mountAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history, context: { auth: stubAuthContext } });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  resetConfigForTests();
  vi.stubEnv('VITE_SERVER_URL', '/api/v2');
  vi.stubEnv('VITE_BASE_URI', '/app/');
  vi.stubEnv('VITE_PUBLIC_PROJECT_ID', '11');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetConfigForTests();
});

describe('/auth-callback', () => {
  it('reports success once the session probe confirms a real session', async () => {
    server.use(authorGated({ authed: true }));

    mountAt('/auth-callback?auth_state=state-1');

    await waitFor(() => {
      expect(screen.getByTestId('auth-callback-status')).toHaveAttribute('data-status', 'success');
    });
  });

  it('closes the popup ~300ms after success, only when window.opener is present (old app parity)', async () => {
    server.use(authorGated({ authed: true }));
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
    vi.stubGlobal('opener', { closed: false, postMessage: vi.fn() });

    mountAt('/auth-callback?auth_state=state-1');

    await waitFor(() => {
      expect(screen.getByTestId('auth-callback-status')).toHaveAttribute('data-status', 'success');
    });
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });

  it('reports error when the session probe returns 401 (no real session)', async () => {
    server.use(authorGated({ authed: false }));

    mountAt('/auth-callback?auth_state=state-1');

    await waitFor(() => {
      expect(screen.getByTestId('auth-callback-status')).toHaveAttribute('data-status', 'error');
    });
  });

  it('reports error when required config is missing (no server to probe)', async () => {
    vi.unstubAllEnvs();
    resetConfigForTests();

    mountAt('/auth-callback?auth_state=state-1');

    await waitFor(() => {
      expect(screen.getByTestId('auth-callback-status')).toHaveAttribute('data-status', 'error');
    });
  });
});
