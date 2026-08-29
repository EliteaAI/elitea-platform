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
 * Small, self-contained `pages/agents`-scoped router fixture — same shape
 * and same "not the real app tree" caveat as `pages/apps/__tests__/
 * testRouter.tsx` (unit A-apps): covers exactly the three routes this
 * unit's own pages render at/navigate against (`/agents/$tab`,
 * `/agents/$tab/$agentId`, `/agents/create`), NOT `src/routes/**` (outside
 * this unit's ownership fence). All three render the SAME `content` prop —
 * whichever page a given test is exercising is rendered at whichever of the
 * three paths that test navigates to (a test asserting on `router.state.
 * location.pathname` alone, e.g. "clicking a row navigates to the detail
 * route", never needs a distinct probe component at the destination).
 */
/** The router-context `auth.getUser()` shape the app installs (`src/app/router-context.ts`'s `AuthUser`), narrowed to the two fields the right-hand rail reads. */
export interface TestRouterUser {
  readonly id?: string;
  readonly personal_project_id?: string;
}

function buildTestRouter(initialPath: string, content: ReactElement, projectId: string | undefined, user: TestRouterUser | undefined): AnyRouter {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });

  const tabRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/agents/$tab',
    // `tags[]`/`author_id` are shell-wide in the real tree
    // (`src/routes/-search/common.ts`, mounted on `_shell/route.tsx`), so a
    // fixture that omitted them would silently DROP whatever the right-hand
    // rail writes and make a passing tag-selection test meaningless.
    validateSearch: (search: Record<string, unknown>) => ({
      sort_by: typeof search.sort_by === 'string' ? search.sort_by : undefined,
      sort_order: typeof search.sort_order === 'string' ? search.sort_order : undefined,
      author_id: typeof search.author_id === 'string' ? search.author_id : undefined,
      'tags[]': Array.isArray(search['tags[]']) ? (search['tags[]'] as string[]) : undefined,
    }),
    component: () => content,
  });

  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/agents/$tab/$agentId',
    validateSearch: (search: Record<string, unknown>) => ({
      isFromCreation: typeof search.isFromCreation === 'string' ? search.isFromCreation : undefined,
      history_run_id: typeof search.history_run_id === 'string' ? search.history_run_id : undefined,
    }),
    component: () => content,
  });

  // ROUTE-067 parity (`src/routes/_shell/agents/$tab.$agentId.$version.tsx`)
  // — the optional `/:version` child segment; `EditApplication` reads
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
    path: '/agents/create',
    component: () => content,
  });

  // Where `ChatWithAgentButton` lands — the destination itself is outside
  // this unit (the real page is `processes/chat`'s), so the fixture renders
  // nothing there: a test asserts on `router.state.location.pathname` alone.
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat/$conversationId',
    component: () => null,
  });

  const routeTree = rootRoute.addChildren([tabRoute, detailRoute.addChildren([versionRoute]), createRoute_, chatRoute]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    context: { auth: { getSelectedProjectId: () => projectId, getUser: () => user } },
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

export interface RenderAgentsRouteResult extends RenderResult {
  readonly router: AnyRouter;
  readonly queryClient: QueryClient;
}

export function renderAgentsRoute(
  content: ReactElement,
  initialPath = '/agents/latest',
  options: { queryClient?: QueryClient; projectId?: string; user?: TestRouterUser } = {},
): RenderAgentsRouteResult {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const router = buildTestRouter(initialPath, content, options.projectId, options.user);

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
