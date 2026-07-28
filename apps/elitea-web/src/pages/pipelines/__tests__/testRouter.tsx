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
 * Small, self-contained `pages/pipelines`-scoped router fixture — same
 * shape and same "not the real app tree" caveat as `pages/agents/__tests__/
 * testRouter.tsx` (Wave-2 unit A1g): covers exactly the three routes this
 * unit's own pages render at/navigate against (`/pipelines/$tab`,
 * `/pipelines/$tab/$agentId`, `/pipelines/create`), NOT `src/routes/**`
 * (outside this unit's ownership fence).
 */
function buildTestRouter(initialPath: string, content: ReactElement, projectId: string | undefined): AnyRouter {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });

  const tabRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/pipelines/$tab',
    validateSearch: (search: Record<string, unknown>) => ({
      sort_by: typeof search.sort_by === 'string' ? search.sort_by : undefined,
      sort_order: typeof search.sort_order === 'string' ? search.sort_order : undefined,
    }),
    component: () => content,
  });

  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/pipelines/$tab/$agentId',
    validateSearch: (search: Record<string, unknown>) => ({
      isFromCreation: typeof search.isFromCreation === 'string' ? search.isFromCreation : undefined,
      history_run_id: typeof search.history_run_id === 'string' ? search.history_run_id : undefined,
    }),
    component: () => content,
  });

  // ROUTE-069 parity (`src/routes/_shell/pipelines/$tab.$agentId.$version.tsx`)
  // — the optional `/:version` child segment; `EditPipeline` reads
  // `version` via its own non-strict `useParams`, which picks it up from
  // whichever descendant route actually matched.
  const versionRoute = createRoute({
    getParentRoute: () => detailRoute,
    path: '$version',
    validateSearch: (search: Record<string, unknown>) => ({
      isFromCreation: typeof search.isFromCreation === 'string' ? search.isFromCreation : undefined,
      history_run_id: typeof search.history_run_id === 'string' ? search.history_run_id : undefined,
    }),
  });

  const createRoute_ = createRoute({
    getParentRoute: () => rootRoute,
    path: '/pipelines/create',
    component: () => content,
  });

  const routeTree = rootRoute.addChildren([tabRoute, detailRoute.addChildren([versionRoute]), createRoute_]);

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

export interface RenderPipelinesRouteResult extends RenderResult {
  readonly router: AnyRouter;
  readonly queryClient: QueryClient;
}

export function renderPipelinesRoute(
  content: ReactElement,
  initialPath = '/pipelines/latest',
  options: { queryClient?: QueryClient; projectId?: string } = {},
): RenderPipelinesRouteResult {
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
