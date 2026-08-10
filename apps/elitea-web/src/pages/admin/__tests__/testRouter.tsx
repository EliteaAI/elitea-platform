import type { ReactElement } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

/**
 * Render fixture for `pages/admin/**`, in the same shape as
 * `pages/settings/__tests__/testRouter.tsx`.
 *
 * It deliberately does NOT mount a router. The admin pages are reached through
 * the code-based tree in `pages/admin/router.tsx` and, unlike the settings
 * Users page, none of them calls `useSearch`/`useNavigate` — so a router here
 * would add a second, differently-shaped route tree for tests to drift against
 * without covering anything the pages actually use.
 */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderAdminRouteResult extends RenderResult {
  readonly queryClient: QueryClient;
}

export function renderAdminRoute(
  content: ReactElement,
  options: { queryClient?: QueryClient } = {},
): RenderAdminRouteResult {
  const queryClient = options.queryClient ?? createTestQueryClient();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
        {content}
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return { ...view, queryClient };
}
