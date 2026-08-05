import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { ThemeProvider } from '@mui/material/styles';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '../../../test/setup';
import { installWebStorageShim } from '../../../test/webstorage';

import { VoicePersonalizationSection } from './VoicePersonalizationSection';

installWebStorageShim();

const BASE = '/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

afterEach(() => {
  resetGeneratedClient();
});

/** Same `RouterProvider` + memory-history + `context.auth.getSelectedProjectId` wiring `features/agents/ui/AgentEditor.test.tsx` established — `useSelectedProjectId` requires a REAL router instance in context (`useRouteContext`'s `strict: false` degrades a no-MATCH lookup, not a wholly-absent router). */
function renderWithProviders(projectId: string | undefined): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  function RootComponent() {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <VoicePersonalizationSection />
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => projectId } },
  });

  render(<RouterProvider router={router} />);
}

describe('VoicePersonalizationSection', () => {
  it('renders an accordion section titled "Voice Personalization" containing the voice/speed/volume controls', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/models/p1`, () => HttpResponse.json({ items: [], total: 0 })));

    renderWithProviders('p1');

    await waitFor(() => expect(screen.getByTestId('voice-personalization-section')).toBeInTheDocument());
    expect(screen.getByText('Voice Personalization')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('slider')).toHaveLength(2));
  });

  it('does not crash when there is no selected project id yet', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    expect(() => renderWithProviders(undefined)).not.toThrow();
    await waitFor(() => expect(screen.getByTestId('voice-personalization-section')).toBeInTheDocument());
  });
});
