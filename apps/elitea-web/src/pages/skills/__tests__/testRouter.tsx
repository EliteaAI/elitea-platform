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
  type AnyRouter,
} from '@tanstack/react-router';
import { render, type RenderResult } from '@testing-library/react';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient, type TestSocketClient } from '@/shared/api/socket/testing';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function buildTestRouter(initialPath: string, content: ReactElement, projectId: string | undefined): AnyRouter {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const tabRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/skills/$tab',
    component: () => content,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/skills/$tab/$skillId',
    component: () => content,
  });
  const versionRoute = createRoute({
    getParentRoute: () => detailRoute,
    path: '$version',
  });
  const createRoute_ = createRoute({
    getParentRoute: () => rootRoute,
    path: '/skills/create',
    component: () => content,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([
      tabRoute,
      detailRoute.addChildren([versionRoute]),
      createRoute_,
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    context: { auth: { getSelectedProjectId: () => projectId } },
  });
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderSkillsRouteResult extends RenderResult {
  readonly router: AnyRouter;
  readonly queryClient: QueryClient;
  readonly socketClient: TestSocketClient;
}

export function renderSkillsRoute(
  content: ReactElement,
  initialPath = '/skills/all',
  projectId: string | undefined = 'project-1',
): RenderSkillsRouteResult {
  const queryClient = createTestQueryClient();
  const socketClient = createTestSocketClient();
  const router = buildTestRouter(initialPath, content, projectId);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        <SocketClientContext.Provider value={socketClient}>
          <RouterProvider router={router} />
        </SocketClientContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient, socketClient };
}
