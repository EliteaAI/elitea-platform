import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRoute, createRootRoute, createRouter } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { getGetPlatformSettingsMockHandler } from '@/shared/api/generated/admin/admin.msw';
import { getGetApplicationMockHandler, getListApplicationsMockHandler, getUpdateApplicationRelationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { getListToolkitInstancesMockHandler } from '@/shared/api/generated/toolkits/toolkits.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { ToolMenu } from './ToolMenu';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function platformSettings(mcpEnabled: boolean) {
  return {
    chat_enabled: true,
    applications_enabled: true,
    skills_enabled: true,
    toolkits_enabled: true,
    datasources_enabled: true,
    pipelines_enabled: true,
    publishing_enabled: true,
    moderation_enabled: true,
    mcp_enabled: mcpEnabled,
    support_chat_enabled: true,
  };
}

function applicationDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: '42',
    name: 'Helper Bot',
    description: '',
    icon: '',
    owner_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    versions: [],
    version_details: {
      id: '100',
      application_id: '42',
      name: 'base',
      status: 'draft',
      tools: [],
      meta: {},
    },
    ...overrides,
  };
}

function renderToolMenu(
  props: Partial<React.ComponentProps<typeof ToolMenu>> = {},
  projectId: string | undefined = 'proj-1',
  initialEntries: readonly string[] = ['/'],
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  function Root() {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <ToolMenu {...props} />
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  const rootRoute = createRootRoute({ component: Root });
  // Catch-all splat sibling — matches `widgets/create-button`'s
  // `testRouter.tsx`'s own harness — so a `navigate({ to })` this component
  // makes to a route this bare tree doesn't declare (e.g. `/toolkits/create`,
  // the "create new toolkit" round trip's outbound half) still resolves to
  // something real instead of TanStack's not-found state, letting tests
  // assert on `router.state.location` afterwards.
  const catchAllRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => <div data-testid="test-router-catch-all" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([catchAllRoute]),
    history: createMemoryHistory({ initialEntries: [...initialEntries] }),
    context: { auth: { getSelectedProjectId: () => projectId } },
  });

  const result = render(<RouterProvider router={router} />);
  return { ...result, queryClient, router };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(getGetPlatformSettingsMockHandler(platformSettings(true)));
  server.use(getListToolkitInstancesMockHandler({ rows: [], total: 0 }));
  server.use(getListApplicationsMockHandler({ rows: [], total: 0, page: 0, page_size: 20, total_pages: 0 }));
});

afterEach(() => {
  resetGeneratedClient();
});

describe('ToolMenu — unsaved entity', () => {
  it('disables every add button while applicationId is undefined', async () => {
    renderToolMenu({ applicationId: undefined });
    await waitFor(() => expect(screen.getByTestId('agent-add-toolkit-button')).toBeInTheDocument());
    expect(screen.getByTestId('agent-add-toolkit-button')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Agent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pipeline' })).toBeDisabled();
  });
});

describe('ToolMenu — saved entity', () => {
  it('enables the add buttons once the application detail resolves with a version', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    renderToolMenu({ applicationId: 42 });

    await waitFor(() => expect(screen.getByTestId('agent-add-toolkit-button')).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'Agent' })).not.toBeDisabled();
  });

  it('shows the MCP button when the platform setting is enabled', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    renderToolMenu({ applicationId: 42 });
    expect(await screen.findByRole('button', { name: 'MCP' })).toBeInTheDocument();
  });

  it('hides the MCP button when the platform setting is explicitly disabled', async () => {
    server.use(getGetPlatformSettingsMockHandler(platformSettings(false)));
    server.use(getGetApplicationMockHandler(applicationDetail()));
    renderToolMenu({ applicationId: 42 });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent' })).not.toBeDisabled());
    expect(screen.queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument();
  });

  it('lists agents from the real endpoint, excluding self, in the Agent dropdown', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    server.use(
      getListApplicationsMockHandler((info) => {
        const url = new URL(info.request.url);
        if (url.searchParams.get('agents_type') !== 'classic') return { rows: [], total: 0, page: 0, page_size: 20, total_pages: 0 };
        return {
          rows: [
            { id: '42', name: 'Helper Bot', owner_id: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', is_forked: false, meta: {}, has_interrupt: false },
            { id: '7', name: 'Other Bot', owner_id: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', is_forked: false, meta: {}, has_interrupt: false },
          ],
          total: 2,
          page: 0,
          page_size: 20,
          total_pages: 1,
        };
      }),
    );

    renderToolMenu({ applicationId: 42 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));

    expect(await screen.findByText('Other Bot')).toBeInTheDocument();
    // "Helper Bot" is applicationId 42 itself -- excluded from its own Agent dropdown.
    expect(screen.queryByText('Helper Bot')).not.toBeInTheDocument();
  });

  it('associates an agent and invalidates the application-detail cache on success', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    server.use(
      getListApplicationsMockHandler((info) => {
        const url = new URL(info.request.url);
        if (url.searchParams.get('agents_type') !== 'classic') return { rows: [], total: 0, page: 0, page_size: 20, total_pages: 0 };
        return {
          rows: [{ id: '7', name: 'Other Bot', owner_id: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', is_forked: false, meta: {}, has_interrupt: false }],
          total: 1,
          page: 0,
          page_size: 20,
          total_pages: 1,
        };
      }),
    );
    server.use(getUpdateApplicationRelationMockHandler({ application_id: '42', version_id: '100', has_relation: true }));

    let onToolsChangedCalls = 0;
    renderToolMenu({ applicationId: 42, onToolsChanged: () => (onToolsChangedCalls += 1) });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    fireEvent.click(await screen.findByText('Other Bot'));

    await waitFor(() => expect(onToolsChangedCalls).toBe(1));
  });

  it('lists real toolkit instances in the Toolkit dropdown, split from MCP-flavoured ones', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    server.use(
      getListToolkitInstancesMockHandler({
        rows: [
          { id: 'tk-1', type: 'github', name: 'GitHub', description: '', settings: {}, meta: {}, created_at: '2026-01-01T00:00:00Z', author_id: 1 },
          { id: 'tk-2', type: 'mcp', name: 'Remote MCP Server', description: '', settings: {}, meta: {}, created_at: '2026-01-01T00:00:00Z', author_id: 1 },
        ],
        total: 2,
      }),
    );

    renderToolMenu({ applicationId: 42 });
    await waitFor(() => expect(screen.getByTestId('agent-add-toolkit-button')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('agent-add-toolkit-button'));
    expect(await screen.findByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Remote MCP Server')).not.toBeInTheDocument();

    // Close the Toolkit dropdown (MUI's Menu marks the rest of the tree aria-hidden while
    // open, which hides the MCP button from getByRole) before opening the MCP one.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'MCP' }));
    expect(await screen.findByText('Remote MCP Server')).toBeInTheDocument();
  });

  it('calls onAttachToolkit (injected — no generated association endpoint exists) when a toolkit row is clicked', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    server.use(
      getListToolkitInstancesMockHandler({
        rows: [{ id: 'tk-1', type: 'github', name: 'GitHub', description: '', settings: {}, meta: {}, created_at: '2026-01-01T00:00:00Z', author_id: 1 }],
        total: 1,
      }),
    );

    let attached: unknown;
    renderToolMenu({ applicationId: 42, onAttachToolkit: (toolkit) => (attached = toolkit) });
    await waitFor(() => expect(screen.getByTestId('agent-add-toolkit-button')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('agent-add-toolkit-button'));
    fireEvent.click(await screen.findByText('GitHub'));

    expect(attached).toMatchObject({ id: 'tk-1', name: 'GitHub' });
  });

  it('"Create new" navigates to the toolkit-creation route with return_url/source_application_id wired for the auto-attach round trip', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    server.use(getListToolkitInstancesMockHandler({ rows: [], total: 0 }));

    const { router } = renderToolMenu({ applicationId: 42 }, 'proj-1', ['/agents/tab/42']);
    await waitFor(() => expect(screen.getByTestId('agent-add-toolkit-button')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('agent-add-toolkit-button'));
    fireEvent.click(await screen.findByText('Create new'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/toolkits/create'));
    expect(router.state.location.search).toMatchObject({
      source_application_id: '42',
      return_url: expect.stringContaining('/agents/tab/42') as unknown,
    });
    // Reverted-bug guard: without the wiring this fix adds, `onCreateNew` calls
    // `navigate({ to: createRoute })` with no `search` at all.
    expect((router.state.location.search as Record<string, unknown>).return_url).not.toBeUndefined();
  });

  it('MCP "Create new" also sets the mcp=true return flag', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    server.use(getListToolkitInstancesMockHandler({ rows: [], total: 0 }));

    const { router } = renderToolMenu({ applicationId: 42 }, 'proj-1', ['/agents/tab/42']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'MCP' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'MCP' }));
    fireEvent.click(await screen.findByText('Create new'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/mcps/create'));
    expect(router.state.location.search).toMatchObject({ mcp: 'true', source_application_id: '42' });
  });

  it('auto-attaches a toolkit returned via ?newToolkitId= and clears the round-trip URL params', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    server.use(
      getListToolkitInstancesMockHandler({
        rows: [{ id: 'tk-9', type: 'github', name: 'GitHub', description: '', settings: {}, meta: {}, created_at: '2026-01-01T00:00:00Z', author_id: 1 }],
        total: 1,
      }),
    );

    let attached: unknown;
    const { router } = renderToolMenu(
      { applicationId: 42, onAttachToolkit: (toolkit) => (attached = toolkit) },
      'proj-1',
      ['/agents/tab/42?newToolkitId=tk-9&source_application_id=42&return_url=%2Fagents%2Ftab%2F42'],
    );

    await waitFor(() => expect(attached).toMatchObject({ id: 'tk-9', name: 'GitHub' }));
    // Reverted-bug guard: without this fix's watcher effect, `attached` never
    // gets set and `newToolkitId`/`return_url`/`source_application_id` stay in the URL forever.
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('newToolkitId'));
    expect(router.state.location.search).not.toHaveProperty('source_application_id');
    expect(router.state.location.search).not.toHaveProperty('return_url');
  });

  it('does not auto-attach a returned toolkit id that is not in the currently-fetched instance page (disclosed limitation) but still cleans up the URL', async () => {
    server.use(getGetApplicationMockHandler(applicationDetail()));
    server.use(getListToolkitInstancesMockHandler({ rows: [], total: 0 }));

    let attachedCalls = 0;
    const { router } = renderToolMenu(
      { applicationId: 42, onAttachToolkit: () => (attachedCalls += 1) },
      'proj-1',
      ['/agents/tab/42?newToolkitId=tk-missing'],
    );

    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('newToolkitId'));
    expect(attachedCalls).toBe(0);
  });
});
