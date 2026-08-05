import type { ReactNode } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useChildMatches,
  useParams,
} from '@tanstack/react-router';
import type { AnyRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { AppDetail } from '../AppDetail';
import { Apps } from '../Apps';

/**
 * Reimplementation of `src/routes/-ui/ExclusiveOutlet.tsx` (unit R1) for
 * this test fixture only — importing the real one would reach upward from
 * `pages/` into `routes/` (R-L1), which this fixture avoids on principle
 * even in tests. Same behaviour: render `children` (here, `Apps`) only
 * when no child route matched, otherwise render just the `Outlet` so
 * `/apps/$tab/$appId` shows `AppDetail` alone, not `Apps` AND `AppDetail`
 * stacked. Real `/apps/$tab.tsx` needs this same shape once it stops
 * rendering `RouteShell` and starts rendering `Apps` for real (also
 * outside this unit's ownership — see `Apps.tsx`'s own doc comment on the
 * general routing-wiring gap).
 */
function ExclusiveTabOutlet({ children }: { children: ReactNode }) {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return (
    <>
      {children}
      <Outlet />
    </>
  );
}

function CreateAppTypeProbe() {
  // Generic hook, not a route-specific `.useParams()`: the latter types
  // itself against the route object's OWN registration, which is circular
  // (and typed `never`) while the route is still being constructed below.
  const params = useParams({ strict: false }) as { appType?: string };
  return <output data-testid="create-app-type-probe">{params.appType}</output>;
}

/**
 * Minimal real router for `pages/apps`'s own integration tests — `Apps`/
 * `AppDetail` call `useParams`/`useSearch`/`useNavigate` generically (no
 * specific `Route` import, per this unit's own R-L1 layering constraint;
 * see `Apps.tsx`'s doc comment), which means a real, multi-route
 * `RouterProvider` tree is the only way to exercise them — this is NOT the
 * real app's route tree (`src/routes/**`, out of this unit's ownership); a
 * small, self-contained fixture covering exactly the three routes this
 * page's own navigation touches (`/apps/`, `/apps/$tab`,
 * `/apps/create/$appType`).
 */
function buildTestRouter(initialPath: string, projectId: string | undefined): AnyRouter {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });

  const appsIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/apps/',
    component: Apps,
  });

  const appsTabRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/apps/$tab',
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === 'string' ? search.view : undefined,
    }),
    component: () => (
      <ExclusiveTabOutlet>
        <Apps />
      </ExclusiveTabOutlet>
    ),
  });

  const appsTabAppIdRoute = createRoute({
    getParentRoute: () => appsTabRoute,
    path: '$appId',
    component: AppDetail,
  });

  const appsCreateAppTypeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/apps/create/$appType',
    component: CreateAppTypeProbe,
  });

  const routeTree = rootRoute.addChildren([
    appsIndexRoute,
    appsTabRoute.addChildren([appsTabAppIdRoute]),
    appsCreateAppTypeRoute,
  ]);

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

export interface RenderAppsRouteResult extends RenderResult {
  readonly router: AnyRouter;
  readonly queryClient: QueryClient;
}

export function renderAppsRoute(
  initialPath: string,
  options: { projectId?: string; queryClient?: QueryClient } = {},
): RenderAppsRouteResult {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const router = buildTestRouter(initialPath, options.projectId);

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
