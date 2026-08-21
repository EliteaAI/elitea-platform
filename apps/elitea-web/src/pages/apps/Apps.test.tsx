import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { getListApplicationsMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { getListToolkitsMockHandler } from '@/shared/api/generated/toolkits/toolkits.msw';
import { getModerationStatusMockHandler } from '@/shared/api/generated/admin/admin.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderAppsRoute } from './__tests__/testRouter';

function applicationsList(total: number) {
  return {
    rows: Array.from({ length: total }, (_, index) => ({
      id: String(index + 1),
      name: `App ${index + 1}`,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      owner_id: 'user-1',
      is_forked: false,
      meta: null,
      has_interrupt: false,
    })),
    total,
    page: 1,
    page_size: 20,
    total_pages: total > 0 ? 1 : 0,
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(
    getListToolkitsMockHandler({}),
    // EVERY catalogue render now asks for moderation status. `useModerationRequests`
    // sends one request per catalogue entry, and it only stopped sending them
    // before because the selected project id was undefined and the queries were
    // disabled. This suite runs with `onUnhandledRequest: 'error'` (R-M5), so an
    // unmatched status request breaks the render, and the catalogue card never
    // appears. That is what made this file fail about one run in three.
    getModerationStatusMockHandler(),
  );
});

afterEach(() => {
  resetGeneratedClient();
});

describe('Apps (ROUTE-036/039)', () => {
  it('redirects a bare /apps to /apps/catalog when the project has no configured applications', async () => {
    server.use(getListApplicationsMockHandler(applicationsList(0)));
    const { router } = renderAppsRoute('/apps/', { projectId: 'proj-1' });

    await waitFor(() => expect(router.state.location.pathname).toBe('/apps/catalog'));
    expect(await screen.findByText('Wikis')).toBeInTheDocument();
  });

  it('a bare /apps redirects to /apps/catalog even when the project HAS configured applications — a genuine, faithfully-reproduced baseline race, not a defect in this port', async () => {
    // `hasApplications` starts `false` (the query has not resolved on the
    // very first render), so `normalizeAppsTab(undefined, false)` computes
    // 'catalog' and the redirect effect fires immediately — to
    // `/apps/catalog`. Once there, 'catalog' is itself a RECOGNISED tab
    // value, so `normalizeAppsTab('catalog', hasApplications)` takes the
    // "already valid, pass through" branch on every later render and never
    // re-derives off the (by-then-true) `hasApplications`, no matter how
    // long the app stays mounted. This is not specific to the port: the
    // baseline's `Apps.jsx` has the exact same `useMemo`/`useEffect` shape
    // over an equally-async `useToolkitsListQuery`, so a real user visiting
    // bare `/apps` lands on the catalog tab first every time in practice,
    // regardless of whether the project has applications — reproduced
    // byte-for-byte (N4), not fixed.
    server.use(getListApplicationsMockHandler(applicationsList(1)));
    const { router } = renderAppsRoute('/apps/', { projectId: 'proj-1' });

    await waitFor(() => expect(router.state.location.pathname).toBe('/apps/catalog'));
  });

  it('redirects the legacy /apps/all alias to /apps/catalog', async () => {
    server.use(getListApplicationsMockHandler(applicationsList(0)));
    const { router } = renderAppsRoute('/apps/all', { projectId: 'proj-1' });

    await waitFor(() => expect(router.state.location.pathname).toBe('/apps/catalog'));
  });

  it('redirects an unrecognised :tab value to the computed default', async () => {
    server.use(getListApplicationsMockHandler(applicationsList(0)));
    const { router } = renderAppsRoute('/apps/bogus', { projectId: 'proj-1' });

    await waitFor(() => expect(router.state.location.pathname).toBe('/apps/catalog'));
  });

  it('renders the App Catalog tab content at /apps/catalog', async () => {
    server.use(getListApplicationsMockHandler(applicationsList(0)));
    renderAppsRoute('/apps/catalog', { projectId: 'proj-1' });

    expect(await screen.findByText('Wikis')).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
  });

  it('renders the (composition-gap) Applications tab panel at /apps/applications without crashing', async () => {
    server.use(getListApplicationsMockHandler(applicationsList(1)));
    renderAppsRoute('/apps/applications', { projectId: 'proj-1' });

    await waitFor(() => expect(screen.getByTestId('apps-applications-tab-panel')).toBeInTheDocument());
    expect(screen.queryByText('Wikis')).not.toBeInTheDocument();
  });

  it('switching tabs updates the URL', async () => {
    server.use(getListApplicationsMockHandler(applicationsList(1)));
    const user = userEvent.setup();
    const { router } = renderAppsRoute('/apps/applications', { projectId: 'proj-1' });

    await waitFor(() => expect(router.state.location.pathname).toBe('/apps/applications'));
    await user.click(screen.getByRole('tab', { name: /App Catalog/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/apps/catalog'));
    expect(await screen.findByText('Wikis')).toBeInTheDocument();
  });

  it('clicking Configure on a catalog card navigates to /apps/create/:appType', async () => {
    server.use(
      getListToolkitsMockHandler({ inventory: { metadata: { application: true, label: 'Inventory' } } }),
      getListApplicationsMockHandler(applicationsList(0)),
    );
    const user = userEvent.setup();
    const { router } = renderAppsRoute('/apps/catalog', { projectId: 'proj-1' });

    const configureButton = await screen.findByRole('button', { name: 'Configure' });
    await user.click(configureButton);

    await waitFor(() => expect(router.state.location.pathname).toBe('/apps/create/inventory'));
    expect(await screen.findByTestId('create-app-type-probe')).toHaveTextContent('inventory');
  });
});
