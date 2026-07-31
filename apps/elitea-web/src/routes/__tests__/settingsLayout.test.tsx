import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';
import { stubAuthContext } from '@/app/router-context';

/**
 * ROUTE-051..066 nested layout (spec §9.3 R1 RED/GREEN (e)) + D4's
 * ROUTE-076 anomaly ("`/settings/:tab` with an unknown tab renders the
 * Settings layout with an empty outlet — no 404, no redirect") in one
 * suite: both exercise the SAME real, generated route tree
 * (`src/routeTree.gen.ts`), mounted through a real `RouterProvider` with an
 * in-memory history — no mocking of the router itself (§6.2).
 */
function mountAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history, context: { auth: stubAuthContext } });
  render(<RouterProvider router={router} />);
  return router;
}

describe('settings nested layout', () => {
  it('RED/GREEN (e): renders the correct child for a known tab (model-configuration)', async () => {
    mountAt('/settings/model-configuration');

    await waitFor(() => {
      expect(screen.getByTestId('route-shell')).toHaveAttribute(
        'data-route-id',
        'settings.model-configuration',
      );
    });
  });

  it('RED/GREEN (e): renders a different child for a different known tab (secrets)', async () => {
    mountAt('/settings/secrets');

    await waitFor(() => {
      expect(screen.getByTestId('route-shell')).toHaveAttribute('data-route-id', 'settings.secrets');
    });
  });

  it('index redirect: /settings alone lands on model-configuration', async () => {
    mountAt('/settings');

    await waitFor(() => {
      expect(screen.getByTestId('route-shell')).toHaveAttribute(
        'data-route-id',
        'settings.model-configuration',
      );
    });
  });

  it('D4 ROUTE-076 anomaly: an unknown tab renders the layout with an empty outlet — no 404, no redirect', async () => {
    const router = mountAt('/settings/this-tab-does-not-exist');

    await waitFor(() => {
      expect(router.state.status).toBe('idle');
    });

    // No route-shell content anywhere (the $tab.tsx catch-all renders null)…
    expect(screen.queryByTestId('route-shell')).not.toBeInTheDocument();
    // …and the resolved match is the settings catch-all, NOT a 404 and NOT
    // a redirect: the URL stays exactly where it was.
    expect(router.state.location.pathname).toBe('/settings/this-tab-does-not-exist');
    const matchedIds = (router.state.matches as { routeId?: string }[]).map((match) => match.routeId);
    expect(matchedIds).toContain('/_shell/settings/$tab');
    expect(matchedIds).not.toContain('/$projectId/$');
  });
});
