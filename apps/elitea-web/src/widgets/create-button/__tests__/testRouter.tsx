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
import { render } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

/**
 * Self-contained router harness for this widget's component tests — NOT the
 * app's real route tree (this widget owns none of `src/routes/**`). A
 * plain, untyped `createRootRoute` with one child route PER pathname the
 * test needs is enough to give `useNavigate`/`useRouterState` a real
 * `RouterProvider` context (§6.2: no router mocking) without depending on
 * R1's registered tree.
 */
// No explicit return-type annotation (deliberate) — see
// `widgets/app-shell/__tests__/testHarness.tsx`'s `renderWithNavigation`
// header for why `ReturnType<typeof createRouter>` does not structurally
// match a specific call's router under `exactOptionalPropertyTypes`.
export async function renderAtPath(pathname: string, ui: ReactNode) {
  const rootRoute = createRootRoute();
  const testRoute = createRoute({
    getParentRoute: () => rootRoute,
    // Relative to the root ('/'): a leading-slash-free multi-segment path
    // (verified empirically — a leading-slash path here never matched,
    // leaving the router on its (nonexistent) not-found state).
    path: pathname.replace(/^\//, ''),
    component: () => ui as ReactElement,
  });
  // Catch-all splat sibling so a `navigate({ to })` call the component under
  // test makes to any OTHER destination still resolves to something real
  // (not TanStack's not-found state) — lets tests assert on
  // `router.state.location.pathname`/`.search` after a click.
  const catchAllRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => <div data-testid="test-router-catch-all" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute, catchAllRoute]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  // TanStack Router resolves its initial match asynchronously — a bare
  // synchronous `render()` observes the router still in its pre-match state
  // (empty tree). `router.load()` is the documented way to await that first
  // resolution (also used for SSR critical-data warm-up); awaiting it here
  // means every call site gets a component that has already mounted, rather
  // than every test needing its own `waitFor`.
  await router.load();
  const result = render(
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
    >
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return { ...result, router };
}
