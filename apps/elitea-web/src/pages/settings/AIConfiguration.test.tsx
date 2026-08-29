/**
 * Regression coverage for issue #80 — the settings page composed two of the
 * four levels the baseline composes.
 *
 * `apps/elitea-ui` renders `pages/settings/AIConfiguration.jsx` ->
 * `Configuration/ModelConfiguration.jsx` -> (project config, configurations
 * panel, MODEL CAPABILITIES, and a copy-the-whole-card button). This app
 * skipped the middle level, so `ModelCapabilitiesSection.tsx` sat in the tree
 * with no importer and the copy button did not exist. This file pins both back
 * onto the page.
 */
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { resetConfigForTests } from '@/shared/config/get-config';
import { PERMISSIONS } from '@/shared/lib/permissions';

import { server } from '../../test/setup';

import { AIConfiguration } from './AIConfiguration';

const BASE = '/api/v2';
const PROJECT_ID = '1';

const globals = globalThis as unknown as Record<string, unknown>;

/**
 * The catalogue answer of elitea-main: capability BOOLEANS at the top level of
 * the item, and no `capabilities` map
 * (`services/elitea-main/internal/application/configurations/models.go`).
 */
const MODEL_CATALOGUE = {
  total: 1,
  items: [
    {
      name: 'gpt-4o',
      display_name: 'GPT-4o',
      project_id: PROJECT_ID,
      shared: false,
      default: true,
      supports_reasoning: true,
      supports_vision: true,
    },
  ],
  default_model_name: 'gpt-4o',
  default_model_project_id: PROJECT_ID,
};

const LLM_CONFIGURATION = {
  id: 1,
  project_id: PROJECT_ID,
  elitea_title: 'OpenAI GPT-4o',
  label: 'openai',
  type: 'openai',
  section: 'llm',
  shared: false,
  data: { name: 'gpt-4o' },
};

function setConfig(): void {
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example.test/api/v2',
    vite_base_uri: '/',
    vite_public_project_id: '99',
  };
  resetConfigForTests();
}

function mockBackend(): void {
  server.use(
    http.get(`${BASE}/configurations/models/${PROJECT_ID}`, () => HttpResponse.json(MODEL_CATALOGUE)),
    http.get(`${BASE}/configurations/configurations/${PROJECT_ID}`, ({ request }) => {
      const section = new URL(request.url).searchParams.get('section');
      return HttpResponse.json({
        total: section === 'llm' ? 1 : 0,
        items: section === 'llm' ? [LLM_CONFIGURATION] : [],
      });
    }),
    http.get(`${BASE}/auth/permissions/prompt_lib/${PROJECT_ID}`, () =>
      HttpResponse.json([{ name: PERMISSIONS.configuration.update, enabled: true }]),
    ),
  );
}

/** `AddModelButton` and `ConfigurationCard` navigate, so a real router is needed. */
function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
          <CssBaseline />
          <AIConfiguration projectId={PROJECT_ID} />
        </ThemeProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  resetGeneratedClient();
  Reflect.deleteProperty(globalThis.navigator, 'clipboard');
});

describe('AIConfiguration — the ModelConfiguration layer', () => {
  it('shows the capability chips of the project default model', async () => {
    setConfig();
    configureGeneratedClient({ baseUrl: BASE });
    mockBackend();

    renderPage();

    expect(await screen.findByText('Model Capabilities')).toBeInTheDocument();
    expect(await screen.findByText('Reasoning')).toBeInTheDocument();
    expect(await screen.findByText('Vision')).toBeInTheDocument();
  });

  it('copies the whole card, capabilities included, as JSON', async () => {
    setConfig();
    configureGeneratedClient({ baseUrl: BASE });
    mockBackend();

    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    /* jsdom ships no `navigator.clipboard`, and the property is not writable —
       define it, and take it away again in `afterEach`. */
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderPage();

    const copyButton = await screen.findByRole('button', { name: 'Copy configuration' });
    await userEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(writeText.mock.calls[0]?.[0] ?? '{}') as Record<string, unknown>;
    expect(payload['model_capabilities']).toEqual(['reasoning', 'vision']);
    expect(payload['project_configuration']).toEqual({
      server_url: 'https://elitea.example.test/api/v2',
      base_url: 'https://elitea.example.test/llm/v1',
      project_id: PROJECT_ID,
    });
  });

  it('shows no capability row for a model that declares no capability', async () => {
    setConfig();
    configureGeneratedClient({ baseUrl: BASE });
    mockBackend();
    server.use(
      http.get(`${BASE}/configurations/models/${PROJECT_ID}`, () =>
        HttpResponse.json({
          ...MODEL_CATALOGUE,
          items: [{ name: 'gpt-4o', project_id: PROJECT_ID, shared: false, default: true }],
        }),
      ),
    );

    renderPage();

    /* Wait for the panel, so the absence below is a settled answer and not a
       screen that has not rendered yet. */
    expect(await screen.findByText('LLM Models')).toBeInTheDocument();
    expect(screen.queryByText('Model Capabilities')).not.toBeInTheDocument();
  });

  it('shows no capability section on the OpenAI-Template tab', async () => {
    setConfig();
    configureGeneratedClient({ baseUrl: BASE });
    mockBackend();

    renderPage();

    await screen.findByText('Model Capabilities');
    await userEvent.click(screen.getByRole('tab', { name: 'OpenAI Template' }));

    await waitFor(() => expect(screen.queryByText('Model Capabilities')).not.toBeInTheDocument());
  });
});
