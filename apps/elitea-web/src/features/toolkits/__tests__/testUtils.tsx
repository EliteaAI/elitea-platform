import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderHookOptions, RenderHookResult, RenderResult } from '@testing-library/react';
import { render, renderHook } from '@testing-library/react';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';

/**
 * Local test-render helper for `features/toolkits` (test-only file; not
 * part of this slice's public API). A near-identical harness already
 * exists at `features/agents/__tests__/testUtils.tsx` (Wave-2 unit A1) and
 * `features/apps/__tests__/testUtils.tsx` (unit F5), but `no-sideways-
 * features` forbids importing across `features/*` slices — including
 * test-only files (verified against `.dependency-cruiser.cjs`'s
 * `no-sideways-features` pattern: `^src/features/([^/]+)/`, no test-path
 * carve-out) — same precedent those two files' own doc comments already
 * document for this exact class of duplication.
 */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Providers({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, queryClient: QueryClient = createTestQueryClient()): RenderResult {
  return render(<Providers queryClient={queryClient}>{ui}</Providers>);
}

export function renderHookWithProviders<TResult, TProps>(
  callback: (props: TProps) => TResult,
  queryClient: QueryClient = createTestQueryClient(),
  options?: Omit<RenderHookOptions<TProps>, 'wrapper'>,
): RenderHookResult<TResult, TProps> {
  return renderHook(callback, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) => <Providers queryClient={queryClient}>{children}</Providers>,
  });
}

/**
 * A real, COMPONENT-mounting router harness — needed by any hook chain that
 * bottoms out at `useSelectedProjectId` (`../lib/hooks/useSelectedProjectId.ts`),
 * which throws/returns nonsense outside a `<RouterProvider>` ancestor.
 * Mirrors `features/agents/__tests__/testUtils.tsx`'s
 * `renderWithRouterAndProject` exactly (same underlying `useRouteContext`
 * seam, `src/app/router-context.ts`'s `auth.getSelectedProjectId()`).
 * Not exported: every current caller in this slice goes through
 * `renderHookWithRouterAndProject` below, which wraps it.
 */
function renderWithRouterAndProject(
  ui: ReactElement,
  projectId: string | undefined,
  queryClient: QueryClient = createTestQueryClient(),
): RenderResult {
  function RootComponent(): ReactNode {
    return <Providers queryClient={queryClient}>{ui}</Providers>;
  }
  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => projectId } },
  });
  return render(<RouterProvider router={router} />);
}

/**
 * Captures a plain-callback hook's return value while mounted under a REAL
 * router root context (needed by anything bottoming out at
 * `useSelectedProjectId`) — `renderHook`'s own `wrapper` option cannot
 * install a `<RouterProvider>` around a route tree the way `render` can, so
 * this mounts a probe component and re-reads its captured value on every
 * render via a mutable box, mirroring `features/agents/__tests__/
 * testUtils.tsx`'s own `renderWithRouterAndProject` component-mounting
 * approach rather than `@testing-library/react`'s `renderHook`.
 */
export function renderHookWithRouterAndProject<TResult>(
  callback: () => TResult,
  projectId: string | undefined,
  queryClient: QueryClient = createTestQueryClient(),
): { readonly getResult: () => TResult } {
  const box: { current: TResult | undefined } = { current: undefined };

  function ProbeComponent(): null {
    box.current = callback();
    return null;
  }

  renderWithRouterAndProject(<ProbeComponent />, projectId, queryClient);

  return {
    getResult: () => box.current as TResult,
  };
}

/**
 * Mounts a COMPONENT (not a bare hook callback) under the same real
 * router-root-context + real socket-client + theme + query-client stack as
 * `renderWithRouterAndProject` — for UI components (not hooks) whose own
 * hook chain bottoms out at both `useSelectedProjectId` AND
 * `useSocketClient` (e.g. anything that calls this slice's
 * `useGetCurrentToolkitSchemas`, directly or transitively). Added by unit
 * A4d for `NameDescriptionInput.tsx`/`ToolCustom.tsx`'s own tests — R-M1
 * forbids `vi.mock()`ing that hook chain, so real component-level tests
 * need this full stack instead, mirroring
 * `lib/hooks/useGetCurrentToolkitSchemas.hooks.test.tsx`'s own
 * `renderToolkitSchemas` harness (that file's `RootComponent`/
 * `SocketClientContext.Provider`/router setup, generalised for any UI,
 * not just a probe component).
 */
export function renderWithRouterSocketAndProject(ui: ReactElement, projectId: string | undefined, queryClient: QueryClient = createTestQueryClient()): RenderResult {
  function RootComponent(): ReactNode {
    return (
      <Providers queryClient={queryClient}>
        <SocketClientContext.Provider value={createTestSocketClient()}>{ui}</SocketClientContext.Provider>
      </Providers>
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
