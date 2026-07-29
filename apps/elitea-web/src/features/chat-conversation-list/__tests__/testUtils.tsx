import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

/**
 * Local test-render helper for `features/chat-conversation-list` (test-only
 * file; not part of this slice's public API). Near-identical harnesses
 * already exist at `features/toolkits/__tests__/testUtils.tsx`,
 * `features/agents/__tests__/testUtils.tsx`, `features/pipelines/
 * __tests__/testUtils.tsx`, and `features/apps/__tests__/testUtils.tsx` —
 * `no-sideways-features` forbids importing across `features/*` slices
 * (including test-only files), so this is a 5th copy of the same minimal
 * `QueryClientProvider` + `ThemeProvider` harness, per those files' own
 * established precedent for this exact class of duplication. No router/
 * socket context here (unlike toolkits' fuller harness): none of this
 * unit's components resolve a project id or open a socket internally —
 * `projectId` is an explicit prop everywhere (this slice's own N4
 * signature-deviation convention).
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

/**
 * `rerender` is overridden to re-wrap in the SAME `Providers` tree — RTL's
 * raw `rerender(ui)` replaces the ENTIRE previously-rendered tree with
 * whatever `ui` is passed, which would silently drop `ThemeProvider`/
 * `QueryClientProvider` for any caller that (reasonably) expects
 * `rerender(<SameComponent .../>)` to work the same way `render` did.
 */
export function renderWithProviders(ui: ReactElement, queryClient: QueryClient = createTestQueryClient()): RenderResult {
  const result = render(<Providers queryClient={queryClient}>{ui}</Providers>);
  return {
    ...result,
    rerender: (nextUi: ReactNode) => {
      result.rerender(<Providers queryClient={queryClient}>{nextUi}</Providers>);
    },
  };
}
