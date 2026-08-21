/**
 * ConfigurationsPanel.test.tsx
 *
 * DEFECT this file pins: picking a "Default model" fired the mutation
 * fire-and-forget, and the only report of a failure was
 * `console.error('Error setting default model:', error)`. The select is
 * controlled from query data with no optimistic update, so on failure the
 * value snapped back to the old default and the user saw a silent revert
 * with no reason. The panel now keeps the message per section and renders it
 * beside the select that failed.
 */
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { PERMISSIONS } from '@/shared/lib/permissions';

import { server } from '../../../../test/setup';

import ConfigurationsPanel from './ConfigurationsPanel';

const BASE = '/api/v2';
const PROJECT_ID = '1';

const globals = globalThis as unknown as Record<string, unknown>;

const LLM_CONFIG = {
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
    vite_server_url: 'https://elitea.example',
    vite_base_uri: '/',
    vite_public_project_id: '99',
  };
  resetConfigForTests();
}

/** `ConfigurationCard` navigates through TanStack Router, so a real router must wrap the panel. */
function renderPanel(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
          <CssBaseline />
          <ConfigurationsPanel
            configurationsBySection={{ llm: [LLM_CONFIG] }}
            projectId={PROJECT_ID}
            isLoading={false}
          />
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

function mockEditPermission(): void {
  server.use(
    http.get(`${BASE}/auth/permissions/prompt_lib/${PROJECT_ID}`, () =>
      HttpResponse.json([{ name: PERMISSIONS.configuration.update, enabled: true }]),
    ),
  );
}

afterEach(() => {
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  resetGeneratedClient();
});

describe('ConfigurationsPanel default-model saving', () => {
  it('shows the server message beside the select when the save fails', async () => {
    setConfig();
    configureGeneratedClient({ baseUrl: BASE });
    mockEditPermission();
    server.use(
      http.get(`${BASE}/configurations/models/${PROJECT_ID}`, () =>
        HttpResponse.json({ items: [], total: 0, default_model_name: '', default_model_project_id: '' }),
      ),
      http.post(`${BASE}/configurations/models/${PROJECT_ID}`, () =>
        HttpResponse.json({ error: 'insufficient permissions' }, { status: 403 }),
      ),
    );

    renderPanel();

    // The three LLM selects are Default / High-tier / Low-tier, in that order.
    // `DefaultSettingsSelects` passes a React node as the label, so none of
    // them carries an accessible name — index is the only handle available.
    const combobox = (await screen.findAllByRole('combobox'))[0] as HTMLElement;
    await waitFor(() => expect(combobox).not.toHaveAttribute('aria-disabled', 'true'));
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByRole('option', { name: 'OpenAI GPT-4o' }));

    expect(await screen.findByText('insufficient permissions')).toBeInTheDocument();
  });

  it('shows no error message when the save succeeds', async () => {
    setConfig();
    configureGeneratedClient({ baseUrl: BASE });
    mockEditPermission();
    server.use(
      http.get(`${BASE}/configurations/models/${PROJECT_ID}`, () =>
        HttpResponse.json({ items: [], total: 0, default_model_name: '', default_model_project_id: '' }),
      ),
      http.post(`${BASE}/configurations/models/${PROJECT_ID}`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );

    renderPanel();

    // The three LLM selects are Default / High-tier / Low-tier, in that order.
    // `DefaultSettingsSelects` passes a React node as the label, so none of
    // them carries an accessible name — index is the only handle available.
    const combobox = (await screen.findAllByRole('combobox'))[0] as HTMLElement;
    await waitFor(() => expect(combobox).not.toHaveAttribute('aria-disabled', 'true'));
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByRole('option', { name: 'OpenAI GPT-4o' }));

    await waitFor(() => expect(screen.queryByText('insufficient permissions')).not.toBeInTheDocument());
  });
});
