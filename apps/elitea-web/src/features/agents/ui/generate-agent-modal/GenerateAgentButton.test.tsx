import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPermissionListMockHandler } from '@/shared/api/generated/auth/auth.msw';
import { resetBackendCapabilitiesForTests, setBackendCapabilityForTests } from '@/shared/config/backendCapabilities';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { PERMISSIONS } from '@/shared/lib/permissions';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { server } from '@/test/setup';

import { GenerateAgentButton } from './GenerateAgentButton';

/**
 * §6.2 discipline (R-M1): no `vi.mock()` of application modules — same
 * rule `features/mcps/ui/McpAuthModal.test.tsx`'s own header documents.
 * `GenerateAgentButton` needs BOTH a real TanStack Router context (for
 * `useSelectedProjectId`, via `../../api/useSelectedProjectId`) and a real
 * `usePermissionList` network round-trip (for `useHasPermission`) — this
 * harness is the component-rendering counterpart of this slice's own
 * `__tests__/testUtils.tsx`'s `renderHookWithRouter` (that one renders a
 * hook-probe; this one renders the real component tree as the router's
 * root component), rebuilt locally for the same `no-sideways-features`
 * reason that file's own doc comment gives for not sharing
 * `features/apps/__tests__/testUtils.tsx`.
 */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderButtonWithRouter(ui: ReactElement, options: { projectId?: string } = {}): { queryClient: QueryClient } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  function RootComponent() {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          {ui}
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => options.projectId } },
  });

  render(<RouterProvider router={router} />);
  return { queryClient };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  // The draft route is not mounted, so the button is hidden by default — see
  // `shared/config/backendCapabilities`. These cases are about the PERMISSION
  // gate, so they turn the capability on.
  setBackendCapabilityForTests('aiGeneration', true);
});

afterEach(() => {
  resetGeneratedClient();
  resetBackendCapabilitiesForTests();
});

describe('GenerateAgentButton', () => {
  it('renders nothing while the permission list has not resolved yet', () => {
    server.use(getPermissionListMockHandler([]));
    renderButtonWithRouter(<GenerateAgentButton onAgentCreated={vi.fn()} />, { projectId: 'p1' });

    expect(screen.queryByText('Build with AI')).not.toBeInTheDocument();
  });

  it('renders nothing when the user lacks applications.update', async () => {
    server.use(getPermissionListMockHandler([{ name: 'some.other.permission', enabled: true }]));
    renderButtonWithRouter(<GenerateAgentButton onAgentCreated={vi.fn()} />, { projectId: 'p1' });

    await waitFor(() => expect(screen.queryByText('Build with AI')).not.toBeInTheDocument());
  });

  /**
   * The draft route is not mounted. `POST /elitea_core/
   * generate_application_draft/prompt_lib/{projectId}` answers
   * `404 page not found`, so the button could only ever fail. It stays hidden
   * until the route lands — see `shared/config/backendCapabilities`.
   */
  it('renders nothing while the draft route is unmounted, permission or not', async () => {
    resetBackendCapabilitiesForTests();
    server.use(getPermissionListMockHandler([{ name: PERMISSIONS.applications.update, enabled: true }]));
    renderButtonWithRouter(<GenerateAgentButton onAgentCreated={vi.fn()} />, { projectId: 'p1' });

    await waitFor(() => expect(screen.queryByText('Build with AI')).not.toBeInTheDocument());
  });

  it('renders the button once the user has applications.update', async () => {
    server.use(getPermissionListMockHandler([{ name: PERMISSIONS.applications.update, enabled: true }]));
    renderButtonWithRouter(<GenerateAgentButton onAgentCreated={vi.fn()} />, { projectId: 'p1' });

    await waitFor(() => expect(screen.getByText('Build with AI')).toBeInTheDocument());
  });

  it('does not render when the matching permission entry is disabled', async () => {
    server.use(getPermissionListMockHandler([{ name: PERMISSIONS.applications.update, enabled: false }]));
    renderButtonWithRouter(<GenerateAgentButton onAgentCreated={vi.fn()} />, { projectId: 'p1' });

    await waitFor(() => expect(screen.queryByText('Build with AI')).not.toBeInTheDocument());
  });

  it('does not nest a <button> inside BasicAccordion\'s summaryAction <button> wrapper', async () => {
    server.use(getPermissionListMockHandler([{ name: PERMISSIONS.applications.update, enabled: true }]));
    renderButtonWithRouter(
      <BasicAccordion
        items={[
          {
            title: 'Agent',
            content: 'content',
            summaryAction: <GenerateAgentButton onAgentCreated={vi.fn()} />,
          },
        ]}
      />,
      { projectId: 'p1' },
    );

    await waitFor(() => expect(screen.getByText('Build with AI')).toBeInTheDocument());

    const buttons = Array.from(document.body.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.querySelector('button')).toBeNull();
    }
  });
});
