import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, type RenderHookResult, type RenderResult } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Providers({ children, client }: { readonly children: ReactNode; readonly client: QueryClient }): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  client: QueryClient = createTestQueryClient(),
): RenderResult {
  const result = render(<Providers client={client}>{ui}</Providers>);
  return {
    ...result,
    rerender: (nextUi: ReactNode) => {
      result.rerender(<Providers client={client}>{nextUi}</Providers>);
    },
  };
}

export function renderHookWithProviders<TResult>(
  callback: () => TResult,
  client: QueryClient = createTestQueryClient(),
): RenderHookResult<TResult, unknown> {
  return renderHook(callback, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <Providers client={client}>{children}</Providers>
    ),
  });
}
