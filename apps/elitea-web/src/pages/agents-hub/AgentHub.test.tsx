import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { getGetAgentCategoriesMockHandler, getGetPublicApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../test/setup';

import AgentHub from './AgentHub';

const ROWS = [
  {
    project_id: '1',
    id: 'app-1',
    name: 'Research Agent',
    description: '',
    version_id: 'v-1',
    version_name: 'v1',
    agent_type: 'agent',
    meta: { category: 'Productivity' },
  },
  {
    project_id: '1',
    id: 'app-2',
    name: 'Support Bot',
    description: '',
    version_id: 'v-2',
    version_name: 'v1',
    agent_type: 'agent',
    meta: { category: 'Support' },
  },
];

/**
 * The Trending/My Liked buckets hit the exact same URL as the plain
 * bulk-categorize fetch (`useAgentHubData.ts`'s documented backend gap —
 * the handler reads none of `sort_by`/`my_liked` server-side either), so
 * this only returns `ROWS` for the plain bulk request (no `sort_by`/
 * `my_liked` query param) and empty for the other two — otherwise every
 * agent name would appear three times in the DOM (once per bucket) and
 * `findByText` would rightly fail on ambiguity.
 */
function mockAgentsHubData(): void {
  server.use(
    getGetAgentCategoriesMockHandler({
      categories: [
        { name: 'Productivity', is_default: true },
        { name: 'Support', is_default: true },
      ],
      total: 2,
    }),
  );
  server.use(
    // Full `/api/v2` path and the real top-level `{rows, total}` body.
    // The `*` wildcard used to hide the raw-fetch URL bug in
    // `useAgentHubData.ts`. The `data` wrapper used to hide the envelope
    // misread in the same file.
    http.get('/api/v2/elitea_core/public_applications/prompt_lib', ({ request }) => {
      const params = new URL(request.url).searchParams;
      const isBulk = !params.has('sort_by') && !params.has('my_liked');
      const rows = isBulk ? ROWS : [];
      return HttpResponse.json({ rows, total: rows.length }, { status: 200 });
    }),
  );
  server.use(getGetPublicApplicationMockHandler());
}

/** Real `<RouterProvider>` (search params + `useNavigate` inside `AgentModal`) + `<QueryClientProvider>`, mirroring `pages/user-public/ui/ApplicationsPanel.test.tsx`'s own harness. `initialSearch` seeds the `?agentId=` deep link (finding 8). */
function withProviders(ui: ReactNode, initialSearch = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    validateSearch: (search: Record<string, unknown>) => ({ agentId: typeof search['agentId'] === 'string' ? search['agentId'] : undefined }),
    component: () => <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [`/${initialSearch}`] }),
  });
  return { ...renderWithTheme(<RouterProvider router={router} />), router };
}

describe('AgentHub', () => {
  afterEach(() => {
    resetGeneratedClient();
  });

  it('renders both categories with their agents once fetched', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    mockAgentsHubData();

    withProviders(<AgentHub />);

    expect(await screen.findByText('Research Agent')).toBeInTheDocument();
    expect(screen.getByText('Support Bot')).toBeInTheDocument();
    // Both the category-filter chip and the section heading render the
    // category name as text, so these are scoped by role to stay
    // unambiguous.
    expect(screen.getByRole('heading', { name: 'Productivity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Productivity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Support' })).toBeInTheDocument();
  });

  it('filters agents by the search box (adversarial-review fix, cluster A13-agents-hub, finding 9)', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    mockAgentsHubData();
    const user = userEvent.setup();

    withProviders(<AgentHub />);
    await screen.findByText('Research Agent');

    await user.type(screen.getByPlaceholderText('Search for agents'), 'support');

    await waitFor(() => expect(screen.queryByText('Research Agent')).not.toBeInTheDocument());
    expect(screen.getByText('Support Bot')).toBeInTheDocument();
  });

  it('filters down to only the selected category when its chip is clicked (finding 9 — previously dead tag-filter plumbing)', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    mockAgentsHubData();
    const user = userEvent.setup();

    withProviders(<AgentHub />);
    await screen.findByText('Research Agent');

    await user.click(screen.getByRole('button', { name: 'Support' }));

    await waitFor(() => expect(screen.queryByText('Research Agent')).not.toBeInTheDocument());
    expect(screen.getByText('Support Bot')).toBeInTheDocument();
  });

  it('shows a no-results message when the search matches nothing', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    mockAgentsHubData();
    const user = userEvent.setup();

    withProviders(<AgentHub />);
    await screen.findByText('Research Agent');

    await user.type(screen.getByPlaceholderText('Search for agents'), 'nonexistent agent');

    expect(await screen.findByText('No agents found')).toBeInTheDocument();
  });

  /*
   * DEFECT this guards: the hub reports a refused list through
   * `useAgentHubData`'s `error`. No component reads it. The page shows
   * "No agents found". A broken hub then looks like an empty catalogue.
   */
  it('shows a load error instead of the empty state when the list request is refused', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(
      getGetAgentCategoriesMockHandler({
        categories: [{ name: 'Productivity', is_default: true }],
        total: 1,
      }),
    );
    server.use(
      http.get('/api/v2/elitea_core/public_applications/prompt_lib', () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
    );

    withProviders(<AgentHub />);

    expect(
      await screen.findByText('The agent list did not load. Reload the page to try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No agents found')).not.toBeInTheDocument();
  });

  it('auto-opens the deep-linked agent\'s modal once it appears in the fetched data (adversarial-review fix, finding 8)', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    mockAgentsHubData();

    withProviders(<AgentHub />, '?agentId=app-2');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Support Bot')).toBeInTheDocument();
    expect(within(dialog).getByText('Start conversation')).toBeInTheDocument();
  });

  it('does not open any modal when there is no agentId in the URL', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    mockAgentsHubData();

    withProviders(<AgentHub />);

    await screen.findByText('Research Agent');
    expect(screen.queryByText('Start conversation')).not.toBeInTheDocument();
  });
});
