import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { ConfigurationTab } from './ConfigurationTab';
import type { ConfigurationTabProps } from './ConfigurationTab';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

/**
 * `ToolkitForm`'s own `useGetCurrentToolkitSchemas`/`useConfigurationsAsSchema`
 * (`useSelectedProjectId`'s `useRouteContext`, `useQuery`'s real `GET
 * /configurations/available_configurations_by_type` call) need a real
 * `RouterProvider`/`QueryClientProvider` ancestor, and something inside
 * `ToolkitForm`'s own tree reads `useSocketClient()` — all three were
 * missing here (this test file's own pre-existing gap, fixed while already
 * touching this file for the `toolDetailState`/`saveHandlers` prop-grouping
 * change, §3.5's component-props budget), same fixture shape
 * `ToolkitEditor.test.tsx` (this same unit) already establishes.
 */
function renderTab(props: Partial<ConfigurationTabProps> = {}) {
  const saveToolkit = props.saveHandlers?.saveToolkit ?? vi.fn().mockResolvedValue({});
  const renderTestPane = props.slots?.renderTestPane ?? (() => <div>test-pane</div>);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  const rootRoute = createRootRoute({
    component: () => (
      <SocketClientContext.Provider value={createTestSocketClient()}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <ConfigurationTab
            isFetching={false}
            applicationId={undefined}
            toolkitId="tk-1"
            toolDetailState={{ editToolDetail: { id: 'tk-1', type: 'github', name: 'My GitHub', settings: {} }, onChangeToolDetail: vi.fn() }}
            projectId="proj-1"
            saveHandlers={{ saveToolkit }}
            {...props}
            slots={{ ...props.slots, renderTestPane }}
          />
        </ThemeProvider>
      </SocketClientContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => 'proj-1' } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ConfigurationTab', () => {
  it('shows a spinner while fetching', async () => {
    renderTab({ isFetching: true });
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  });

  it('renders the toolkit form and the test pane slot when data is loaded', async () => {
    renderTab();
    expect(await screen.findByText('test-pane')).toBeInTheDocument();
  });

  it('does not render the toolkit form panel when editToolDetail is null', async () => {
    renderTab({ toolDetailState: { editToolDetail: null, onChangeToolDetail: vi.fn() } });
    expect(await screen.findByText('test-pane')).toBeInTheDocument();
  });

  it('shows the run-history view when the history button is clicked and renderRunHistory is provided', async () => {
    const renderRunHistory = vi.fn(() => <div>run-history</div>);
    const user = userEvent.setup();
    renderTab({ slots: { renderTestPane: () => <div>test-pane</div>, renderRunHistory } });

    await user.click(await screen.findByRole('button', { name: /run history|history/i }));

    await waitFor(() => expect(screen.getByText('run-history')).toBeInTheDocument());
    expect(renderRunHistory).toHaveBeenCalledWith(expect.objectContaining({ toolkitId: 'tk-1' }));
  });
});
