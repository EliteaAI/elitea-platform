import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext, RouterContext } from '@/app/router-context';
import { resetConfigForTests } from '@/shared/config/get-config';

import { routeTree } from '../../routeTree.gen';

/**
 * R1 adversarial-verification regression (HIGH finding): malformed search
 * params used to throw an uncaught `ZodError` out of `validateSearch` — see
 * `-search/params.ts`'s CRASH-SAFETY NOTE for the root cause (`.default()`
 * only substitutes on `undefined`, not on a defined-but-invalid value; the
 * JSON literal `null` fell through `toScalarString`/`toStringArray`
 * unchanged) and the fix (`.default()` -> `.catch()`, plus a `null` ->
 * `undefined` fold in both normalisers).
 *
 * These four cases are the adversarial pass's exact probes. Each mounts the
 * REAL generated route tree through a REAL `RouterProvider` (§6.2: no router
 * mocking) at the malformed URL and asserts:
 *  1. the router settles to `idle` with no errored match (the crash symptom
 *     — before the fix this either threw out of `render()` or left an
 *     `error`-status match with no `errorComponent` to display it);
 *  2. the resolved search param actually falls back to the schema's
 *     documented default, not the malformed raw value.
 */

const auth: AuthContext = {
  getUser: () => ({ id: 'u1', permissions: ['models.chat.folders.get'] }),
  getSelectedProjectId: () => '999', // not the public project (VITE_PUBLIC_PROJECT_ID='11')
};

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

function mountAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history, context: { auth } satisfies RouterContext });
  render(<RouterProvider router={router} />);
  return router;
}

async function expectNoCrash(router: ReturnType<typeof mountAt>) {
  await waitFor(() => {
    expect(router.state.status).toBe('idle');
  });
  const erroredMatch = router.state.matches.find((match) => match.status === 'error');
  expect(erroredMatch, `route errored: ${JSON.stringify(erroredMatch?.error)}`).toBeUndefined();
}

describe('malformed search params never crash the route (R1 adversarial-verification HIGH finding)', () => {
  it('/settings/secrets?createSecret=open falls back to createSecret\'s default ("0"), no throw', async () => {
    const router = mountAt('/settings/secrets?createSecret=open');
    await expectNoCrash(router);
    expect(router.state.location.search).toMatchObject({ createSecret: '0' });
  });

  it('/settings/secrets?createSecret=null falls back to createSecret\'s default ("0"), no throw', async () => {
    const router = mountAt('/settings/secrets?createSecret=null');
    await expectNoCrash(router);
    expect(router.state.location.search).toMatchObject({ createSecret: '0' });
  });

  it("/agents/latest?sort_order=bogus falls back to 'desc', no throw", async () => {
    const router = mountAt('/agents/latest?sort_order=bogus');
    await expectNoCrash(router);
    expect(router.state.location.search).toMatchObject({ sort_order: 'desc' });
  });

  it("/help-center?view=bogus falls back to 'grid', no throw", async () => {
    const router = mountAt('/help-center?view=bogus');
    await expectNoCrash(router);
    expect(router.state.location.search).toMatchObject({ view: 'grid' });
  });
});
