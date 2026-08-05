import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderHookOptions, RenderHookResult, RenderResult } from '@testing-library/react';
import { render, renderHook } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

/**
 * Local test-render helper for `features/chat-input` (test-only file; not
 * part of this slice's `index.ts` public API). Near-identical harnesses
 * already exist at `features/agents/__tests__/testUtils.tsx`,
 * `features/toolkits/__tests__/testUtils.tsx`, `features/pipelines/
 * __tests__/testUtils.tsx`, `features/apps/__tests__/testUtils.tsx`, and
 * `features/chat-conversation-list/__tests__/testUtils.tsx` — a 6th copy,
 * per those files' own established precedent: `no-sideways-features`
 * forbids importing across `features/*` slices, including test-only files.
 * No router context here: none of this slice's components/hooks resolve a
 * route param directly (`projectId` etc. are always explicit props/args,
 * matching `features/chat-conversation-list`'s own N4 convention).
 */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

// Not exported (knip: no test file in this slice imports it directly — every
// caller goes through `renderWithProviders`/`renderHookWithProviders`
// below's own default parameter).
function createTestQueryClient(): QueryClient {
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
  const result = render(<Providers queryClient={queryClient}>{ui}</Providers>);
  return {
    ...result,
    rerender: (nextUi: ReactNode) => {
      result.rerender(<Providers queryClient={queryClient}>{nextUi}</Providers>);
    },
  };
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
