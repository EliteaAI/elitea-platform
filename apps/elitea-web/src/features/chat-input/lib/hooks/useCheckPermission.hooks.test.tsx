import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPermissionListMockHandler } from '@/shared/api/generated/auth/auth.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useCheckPermission } from './useCheckPermission.hooks';

/**
 * `useCheckPermission` reads `useSelectedProjectId()` (this slice's own
 * `api/useSelectedProjectId.ts`), which needs a real TanStack Router root
 * context (`useRouteContext` throws with none) — same technique as this
 * slice's own `useSpeakingModeLoop.test.ts`/`useSelectedProjectId.test.tsx`
 * and `features/agents/ui/generate-agent-modal/GenerateAgentButton.test
 * .tsx` (no `vi.mock` of application modules, R-M1).
 */
function ProbeComponent({ permission }: { readonly permission: string }) {
  const { checkPermission } = useCheckPermission();
  return <output>{checkPermission(permission) ? 'allowed' : 'denied'}</output>;
}

function renderWithRouterAndQuery(projectId: string | undefined, permission: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function RootComponent() {
    return (
      <QueryClientProvider client={queryClient}>
        <ProbeComponent permission={permission} />
      </QueryClientProvider>
    );
  }
  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => projectId } },
  });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useCheckPermission', () => {
  it('reports allowed once the matching, enabled permission resolves', async () => {
    server.use(getPermissionListMockHandler([{ name: 'chat.input.test', enabled: true }]));
    renderWithRouterAndQuery('p1', 'chat.input.test');
    await waitFor(() => expect(screen.getByText('allowed')).toBeInTheDocument());
  });

  it('reports denied for a permission not in the list', async () => {
    server.use(getPermissionListMockHandler([{ name: 'some.other.permission', enabled: true }]));
    renderWithRouterAndQuery('p1', 'chat.input.test');
    await waitFor(() => expect(screen.getByText('denied')).toBeInTheDocument());
  });

  it('reports denied when the matching entry is disabled', async () => {
    server.use(getPermissionListMockHandler([{ name: 'chat.input.test', enabled: false }]));
    renderWithRouterAndQuery('p1', 'chat.input.test');
    await waitFor(() => expect(screen.getByText('denied')).toBeInTheDocument());
  });

  it('reports denied (query disabled) when there is no selected project', async () => {
    renderWithRouterAndQuery(undefined, 'chat.input.test');
    expect(await screen.findByText('denied')).toBeInTheDocument();
  });
});
