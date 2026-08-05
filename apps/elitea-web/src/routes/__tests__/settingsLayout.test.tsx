import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { routeTree } from '../../routeTree.gen';
import { stubAuthContext } from '@/app/router-context';

/**
 * Shared QueryClient so tests don't re-create it each run.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, throwOnError: true } },
});

/** Shared Elitea theme — provides palette.border, palette.background, etc. for sx functions. */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

afterEach(() => {
  queryClient.clear();
});

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
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
        <CssBaseline />
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
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

  it('D4 ROUTE-076 anomaly: an unknown tab is handled by SettingsRedirect which redirects to model-configuration', async () => {
    const router = mountAt('/settings/this-tab-does-not-exist');

    await waitFor(() => {
      // SettingsRedirect fires an async redirect for unknown tabs
      expect(router.state.location.pathname).toBe('/settings/model-configuration');
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-shell')).toHaveAttribute(
        'data-route-id',
        'settings.model-configuration',
      );
    });
  });
});
