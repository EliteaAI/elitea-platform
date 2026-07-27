import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import type { RenderHookOptions, RenderHookResult, RenderResult } from '@testing-library/react';
import { render, renderHook } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

/**
 * Local test-render helper for `features/apps` (test-only file; not part of
 * this slice's `index.ts` public API). Deliberately NOT importing
 * `shared/ui/lib/testTheme.tsx`'s `renderWithTheme`: that file has no
 * `index.ts` of its own (S1's flat per-component convention only applies
 * inside `shared/ui/<Component>/`, and `shared/ui/lib/` is not one of
 * those), so importing it here would be a deep, unclear-boundary import
 * from another slice's internals — building the same handful of lines
 * locally, from `shared/brand`'s real public exports, is cheaper than
 * resolving that ambiguity.
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
 * `renderHookWithProviders` cannot serve hooks that call
 * `useSelectedProjectId()` internally (`api/useSelectedProjectId.ts`):
 * that hook needs `useRouteContext`, which throws outside a
 * `<RouterProvider>` tree, and `RouterProvider` does not accept arbitrary
 * `children` the way `renderHook`'s `wrapper` option expects — its root
 * route OWNS what renders. This harness builds a real, minimal
 * single-route router (mirroring `useSelectedProjectId.test.tsx`'s own
 * proof of the wiring) whose root component runs `callback` and captures
 * its return value on every render into a plain mutable box, exposed as
 * `result.current` — the same shape `@testing-library/react`'s own
 * `renderHook` returns, so call sites read identically
 * (`await waitFor(() => expect(result.current.isLoading).toBe(false))`).
 */
export interface RouterHookHarness<TResult> {
  readonly result: { readonly current: TResult };
  readonly queryClient: QueryClient;
}

export function renderHookWithRouter<TResult>(
  callback: () => TResult,
  options: { queryClient?: QueryClient; projectId?: string } = {},
): RouterHookHarness<TResult> {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const box: { current: TResult | undefined } = { current: undefined };

  function Probe() {
    box.current = callback();
    return <output data-testid="hook-probe" />;
  }

  function RootComponent() {
    return (
      <Providers queryClient={queryClient}>
        <Probe />
      </Providers>
    );
  }

  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => options.projectId } },
  });

  render(<RouterProvider router={router} />);

  return {
    result: {
      get current(): TResult {
        // `box.current` is set synchronously during `Probe`'s render,
        // which has always run at least once by the time this getter is
        // first read (React commits synchronously relative to render).
        return box.current as TResult;
      },
    },
    queryClient,
  };
}
