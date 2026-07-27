import type { ReactElement, ReactNode } from 'react';

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { render, type RenderResult } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

/**
 * Self-contained router harness for this widget's component tests — see
 * `widgets/create-button/__tests__/testRouter.tsx` for the full rationale
 * (duplicated rather than shared across widgets: each unit's `__tests__` is
 * inside its own owned path, and a shared test-only helper would need to
 * live in a lower layer this unit does not own).
 */
export async function renderAtPath(pathname: string, ui: ReactNode): Promise<RenderResult> {
  const rootRoute = createRootRoute();
  const testRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: pathname.replace(/^\//, ''),
    component: () => ui as ReactElement,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  await router.load();
  return render(
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
    >
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}
