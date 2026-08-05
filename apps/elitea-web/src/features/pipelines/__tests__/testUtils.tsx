import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderHookOptions, RenderHookResult, RenderResult } from '@testing-library/react';
import { render, renderHook } from '@testing-library/react';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import type { FlowEditorContextValue } from '../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../lib/flow-editor/helpers/pipelineFlow.types';

/** A minimal, fully-stubbed `FlowEditorContextValue` for component tests -- override just the fields a given test cares about. */
export function buildFlowEditorContextValue(overrides: Partial<FlowEditorContextValue> = {}): FlowEditorContextValue {
  const yamlJsonObject: YamlPipelineDocument = overrides.yamlJsonObject ?? { nodes: [] };
  return {
    yamlJsonObject,
    setYamlJsonObject: vi.fn(),
    setFlowNodes: vi.fn(),
    setFlowEdges: vi.fn(),
    ...overrides,
  };
}

/**
 * Local test-render helper for `features/pipelines` (test-only, not part of
 * this slice's `index.ts` public API). Near-identical harnesses already
 * exist in sibling slices (e.g. `features/agents/__tests__/testUtils.tsx`),
 * but `no-sideways-features` forbids importing across `features/*` slices
 * -- including test-only files, per that file's own doc comment (verified
 * against `.dependency-cruiser.cjs`'s `no-sideways-features` pattern, no
 * test-path carve-out). Rebuilt locally rather than resolving that
 * boundary question, matching the established precedent.
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
 * A real, component-mounting router harness -- needed by anything calling
 * `useSelectedProjectId()` (this slice's local duplicate,
 * `../lib/flow-editor/hooks/useSelectedProjectId.ts`), which reads
 * `useRouteContext()` and throws outside any `<RouterProvider>` ancestor.
 */
export function renderWithRouterAndProject(
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
