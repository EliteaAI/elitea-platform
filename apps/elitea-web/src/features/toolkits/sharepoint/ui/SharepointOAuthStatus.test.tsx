import { ThemeProvider } from '@mui/material/styles';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { getAccessToken, setConnectionVerified } from '../lib/helpers/mcpTokenStorage.helpers';
import { SharepointOAuthStatus } from './SharepointOAuthStatus';
import type { SharepointOAuthStatusValues } from './SharepointOAuthStatus';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderWithRouter(values: SharepointOAuthStatusValues, projectId: string | undefined, onLogoutSuccess?: () => void) {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        <SharepointOAuthStatus
          values={values}
          projectId={projectId}
          {...(onLogoutSuccess !== undefined && { onLogoutSuccess })}
        />
      </ThemeProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getUser: () => ({ personal_project_id: 'personal-1' }) } },
  });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  window.sessionStorage.clear();
});

afterEach(() => {
  resetGeneratedClient();
  window.sessionStorage.clear();
});

describe('SharepointOAuthStatus', () => {
  it('renders nothing when there is no sharepoint_configuration reference', () => {
    const { container } = renderWithRouter({}, 'proj-1');
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the referenced credential cannot be resolved', async () => {
    server.use(http.get('*/api/v2/configurations/configurations/proj-1', () => HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0 })));
    const { container } = renderWithRouter({ settings: { sharepoint_configuration: { elitea_title: 'Missing' } } }, 'proj-1');
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('shows "Not Connected" and a Login button for a resolved, not-yet-connected delegated config', async () => {
    server.use(
      http.get('*/api/v2/configurations/configurations/proj-1', () =>
        HttpResponse.json({
          items: [
            {
              id: '1',
              type: 'sharepoint',
              uuid: 'uuid-1',
              elitea_title: 'My SP',
              data: { oauth_discovery_endpoint: 'https://login.microsoftonline.com/tenant' },
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      ),
    );

    renderWithRouter({ id: 'tk-1', settings: { sharepoint_configuration: { elitea_title: 'My SP' } } }, 'proj-1');

    expect(await screen.findByText('Not Connected')).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('shows "Connected!" and a Logout button once the token exists', async () => {
    server.use(
      http.get('*/api/v2/configurations/configurations/proj-1', () =>
        HttpResponse.json({
          items: [
            { id: '1', type: 'sharepoint', uuid: 'uuid-1', elitea_title: 'My SP', data: { oauth_discovery_endpoint: 'https://login.microsoftonline.com/tenant' } },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      ),
    );
    setConnectionVerified('uuid-1:https://login.microsoftonline.com/tenant');

    renderWithRouter({ id: 'tk-1', settings: { sharepoint_configuration: { elitea_title: 'My SP' } } }, 'proj-1');

    expect(await screen.findByText('Connected!')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('clicking Logout then confirming via the injected renderLogoutModal slot removes the token and calls onLogoutSuccess', async () => {
    server.use(
      http.get('*/api/v2/configurations/configurations/proj-1', () =>
        HttpResponse.json({
          items: [
            { id: '1', type: 'sharepoint', uuid: 'uuid-1', elitea_title: 'My SP', data: { oauth_discovery_endpoint: 'https://login.microsoftonline.com/tenant' } },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      ),
    );
    setConnectionVerified('uuid-1:https://login.microsoftonline.com/tenant');
    const onLogoutSuccess = vi.fn();

    const rootRoute = createRootRoute({
      component: () => (
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <SharepointOAuthStatus
            values={{ id: 'tk-1', settings: { sharepoint_configuration: { elitea_title: 'My SP' } } }}
            projectId="proj-1"
            onLogoutSuccess={onLogoutSuccess}
            renderLogoutModal={(slotProps) =>
              slotProps.open ? (
                <button
                  type="button"
                  onClick={slotProps.onConfirm}
                >
                  confirm-logout
                </button>
              ) : null
            }
          />
        </ThemeProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { auth: { getUser: () => ({ personal_project_id: 'personal-1' }) } },
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Logout')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Logout'));
    fireEvent.click(await screen.findByText('confirm-logout'));

    expect(onLogoutSuccess).toHaveBeenCalledTimes(1);
    expect(getAccessToken('uuid-1:https://login.microsoftonline.com/tenant')).toBeNull();
  });
});
