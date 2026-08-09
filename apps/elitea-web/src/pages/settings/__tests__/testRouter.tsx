import type { ReactElement } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { AnyRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

/**
 * Small, self-contained `pages/settings`-scoped router fixture — same shape
 * and same "not the real app tree" caveat as
 * `pages/pipelines/__tests__/testRouter.tsx`: it covers exactly the routes
 * this unit's own pages render at and navigate against, NOT `src/routes/**`.
 *
 * `/settings/users` is here because `pages/settings/Users.tsx` calls both
 * `useSearch({ strict: false })` (PARAM-061 `?inviteUsers=1`) and
 * `navigate({ to: '/settings/users', search: {}, replace: true })` — the
 * deep-link effect throws without a matching route, so a rendering test for
 * that page cannot exist without this fixture. `validateSearch` mirrors
 * `src/routes/_shell/settings/users.tsx`'s `pickParams('inviteUsers')`.
 *
 * Known limitation, measured not assumed: rendering at
 * `/settings/users?inviteUsers=1` runs the page's deep-link effect (the URL
 * ends up at `/settings/users` with empty search, so the effect definitely
 * fired) but the invite dialog is NOT open afterwards — the `setInviteOpen(true)`
 * state does not survive the effect's own `navigate({search:{}, replace:true})`
 * under this fixture. Whether the real `src/routes/**` tree behaves the same
 * way is untested here. Tests that need the invite dialog should click the
 * header's Invite button instead of relying on the deep link.
 */
function buildTestRouter(
  initialPath: string,
  content: ReactElement,
  projectId: string | undefined,
): AnyRouter {
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });

  const usersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/users',
    validateSearch: (search: Record<string, unknown>) => ({
      inviteUsers: typeof search.inviteUsers === 'string' ? search.inviteUsers : undefined,
    }),
    component: () => content,
  });

  const routeTree = rootRoute.addChildren([usersRoute]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    context: { auth: { getSelectedProjectId: () => projectId } },
  });
}

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderSettingsRouteResult extends RenderResult {
  readonly router: AnyRouter;
  readonly queryClient: QueryClient;
}

export function renderSettingsRoute(
  content: ReactElement,
  initialPath = '/settings/users',
  options: { queryClient?: QueryClient; projectId?: string } = {},
): RenderSettingsRouteResult {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const router = buildTestRouter(initialPath, content, options.projectId);

  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return { ...view, router, queryClient };
}
