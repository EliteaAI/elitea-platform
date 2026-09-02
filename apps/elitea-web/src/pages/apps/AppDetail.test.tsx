import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { getGetApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderAppsRoute } from './__tests__/testRouter';

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: '7',
    name: 'Wikis',
    description: 'A wiki toolkit',
    icon: '',
    owner_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    versions: [],
    ...overrides,
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('AppDetail (ROUTE-040)', () => {
  it('shows a spinner while fetching', async () => {
    server.use(getGetApplicationMockHandler(() => new Promise(() => {})));
    renderAppsRoute('/apps/applications/7', { projectId: 'proj-1' });
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  });

  it('shows an error alert when the fetch fails', async () => {
    server.use(getGetApplicationMockHandler(() => Promise.reject(new Error('network down'))));
    renderAppsRoute('/apps/applications/7', { projectId: 'proj-1' });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('renders the EditToolkit slot, not an iframe, when the legacy custom-UI meta keys are present (ADR-0024 WP8)', async () => {
    server.use(
      getGetApplicationMockHandler(
        detail({
          version_details: {
            id: '1',
            application_id: '7',
            name: 'v1',
            status: 'active',
            meta: { custom_ui_route: 'wiki', provider: 'deepwiki' },
          },
        }),
      ),
    );
    renderAppsRoute('/apps/applications/7', { projectId: 'proj-1' });

    await waitFor(() => expect(screen.getByTestId('app-detail-edit-toolkit-slot')).toBeInTheDocument());
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the (composition-gap) EditToolkit slot for an ordinary detail', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderAppsRoute('/apps/applications/7', { projectId: 'proj-1' });

    await waitFor(() => expect(screen.getByTestId('app-detail-edit-toolkit-slot')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
