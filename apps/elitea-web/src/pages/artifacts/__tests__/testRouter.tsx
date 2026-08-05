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

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function buildTestRouter(initialPath: string, content: ReactElement, projectId: string | undefined | null): AnyRouter {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const artifactsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/artifacts',
    component: () => content,
  });
  const createRoute_ = createRoute({
    getParentRoute: () => rootRoute,
    path: '/artifacts/create-bucket',
    component: () => content,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([artifactsRoute, createRoute_]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    context: { auth: { getSelectedProjectId: () => projectId ?? undefined } },
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

export interface RenderArtifactsRouteResult extends RenderResult {
  readonly router: AnyRouter;
}

export function renderArtifactsRoute(
  content: ReactElement,
  initialPath = '/artifacts',
  projectId: string | undefined | null = 'project-1',
): RenderArtifactsRouteResult {
  const queryClient = createTestQueryClient();
  const router = buildTestRouter(initialPath, content, projectId);
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
  return { ...view, router };
}
