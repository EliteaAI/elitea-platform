import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getListApplicationsMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { server } from '../../../test/setup';
import { AGENTS_TAB_ADMIN_PERMISSION } from '../lib/constants';

import { UserPublicPage } from './UserPublicPage';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderPage(
  props: Partial<Parameters<typeof UserPublicPage>[0]> = {},
  auth: { getSelectedProjectId: () => string | undefined; getUser: () => { permissions?: readonly string[] } | undefined } = {
    getSelectedProjectId: () => 'proj-1',
    getUser: () => ({ permissions: [AGENTS_TAB_ADMIN_PERMISSION] }),
  },
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onTabChange = vi.fn();
  const onStatusesChange = vi.fn();

  function Page() {
    return (
      <UserPublicPage
        tab="all"
        onTabChange={onTabChange}
        statuses={[]}
        onStatusesChange={onStatusesChange}
        authorId="author-1"
        authorName="Ada"
        {...props}
      />
    );
  }

  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        <CssBaseline />
        <QueryClientProvider client={queryClient}>
          <Page />
        </QueryClientProvider>
      </ThemeProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth },
  });
  render(<RouterProvider router={router} />);
  return { onTabChange, onStatusesChange };
}

describe('UserPublicPage', () => {
  afterEach(() => {
    resetGeneratedClient();
  });

  it('renders a tab for every permission-visible section, with the given tab active', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getListApplicationsMockHandler({ rows: [], total: 0, page: 1, page_size: 20, total_pages: 0 }));
    renderPage();

    expect(await screen.findByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pipelines' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Toolkits' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'MCPs' })).toBeInTheDocument();
  });

  it('hides the Agents tab without the admin permission (outside the Public project)', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getListApplicationsMockHandler({ rows: [], total: 0, page: 1, page_size: 20, total_pages: 0 }));
    renderPage({}, { getSelectedProjectId: () => 'proj-1', getUser: () => ({ permissions: ['unrelated'] }) });
    expect(await screen.findByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Agents' })).not.toBeInTheDocument();
  });

  it('calls onTabChange with the target tab value when a tab is clicked', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getListApplicationsMockHandler({ rows: [], total: 0, page: 1, page_size: 20, total_pages: 0 }));
    const user = userEvent.setup();
    const { onTabChange } = renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Agents' }));
    expect(onTabChange).toHaveBeenCalledWith('agents');
  });

  it('renders the status filter outside the Public project', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getListApplicationsMockHandler({ rows: [], total: 0, page: 1, page_size: 20, total_pages: 0 }));
    renderPage();
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('renders the toolkits-unavailable panel on the Toolkits tab', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    renderPage({ tab: 'toolkits' });
    expect(await screen.findByText(/toolkit-listing endpoint returns toolkit TYPE schemas/)).toBeInTheDocument();
  });

  it('renders the applications empty state on the Agents tab once loaded', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getListApplicationsMockHandler({ rows: [], total: 0, page: 1, page_size: 20, total_pages: 0 }));
    renderPage({ tab: 'agents' });
    await waitFor(() => expect(screen.getByText('Ada has not created agent yet.')).toBeInTheDocument());
  });

  it('renders no tabs and never fetches applications for a visitor with no permissions (logged-out gate)', async () => {
    // Regression guard for the adversarial-review finding (cluster A12-ui,
    // finding 1): `computeDisplayedTabs` maps every tab, INCLUDING 'all', to
    // `false` when `permissions.length === 0` (`lib/displayed-tabs.ts`), so
    // no tab should ever be "active" here. The old `activeTab =
    // visibleTabs[activeIndex] ?? 'all'` fallback nonetheless treated 'all'
    // as active and mounted `AllStuffPanel`, which fetches real
    // project-application data — exactly the population this permission
    // gate exists to lock out.
    configureGeneratedClient({ baseUrl: '/api/v2' });
    let applicationsFetchCount = 0;
    server.use(
      getListApplicationsMockHandler(() => {
        applicationsFetchCount += 1;
        return { rows: [], total: 0, page: 1, page_size: 20, total_pages: 0 };
      }),
    );
    renderPage({}, { getSelectedProjectId: () => 'proj-1', getUser: () => ({ permissions: [] }) });

    // The status filter (unrelated to tab visibility — it only depends on
    // `isPublicProject`) still renders regardless; waiting for it gives an
    // incorrectly-mounted `AllStuffPanel` a tick to have fired its fetch
    // before the assertions below run.
    await screen.findByRole('combobox');

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(applicationsFetchCount).toBe(0);
  });
});
