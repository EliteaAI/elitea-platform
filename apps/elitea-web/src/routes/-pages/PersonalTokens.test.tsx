/**
 * DEFECT: the Personal Tokens page told the user "No tokens yet" when the
 * read had failed, and again when it had never run.
 *
 * `PersonalTokensPage` destructured only `{data: tokens = [], isFetching}`
 * and branched on `tokens.length === 0`. `eliteaFetch` throws on a non-2xx
 * answer, so a 503 from `/auth/token/` — what elitea-main returns while
 * APPLICATION_SECRET_KEY is empty — settles the query as
 * `isError: true, data: undefined`. Nothing upstream surfaces that: the
 * query client sets no `throwOnError`, and the route's `errorComponent`
 * only catches thrown render/loader errors. So the outage rendered as a
 * confident claim that the user owns no tokens, over a Create-token button
 * whose call would fail as well.
 *
 * The second false empty needs no server at all: the query is gated on
 * `enabled: !!personalProjectId`, and a user with no personal project
 * leaves it disabled — `isPending: true`, `isError: false`, `isFetching:
 * false` — which is why the no-personal-project branch has to be checked
 * before both of the others.
 */
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext, RouterContext } from '@/app/router-context';
import { AppProviders } from '@/app/providers/AppProviders';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';

import { server } from '../../test/setup';
import { PersonalTokensPage } from './PersonalTokens';

const BASE = '/api/v2';
const PUBLIC_PROJECT_ID = '1';
const TOKEN_PATH = `${BASE}/auth/token/`;
const PROJECTS_PATH = `${BASE}/projects/project/default/${PUBLIC_PROJECT_ID}`;

const globals = globalThis as unknown as Record<string, unknown>;

function mountWith(personalProjectId: string | undefined): void {
  const auth: AuthContext = {
    getUser: () => ({ id: 'u1', ...(personalProjectId !== undefined ? { personal_project_id: personalProjectId } : {}), permissions: [], publicPermissions: [] }),
    getSelectedProjectId: () => '',
  };
  const rootRoute = createRootRoute();
  const tokensRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/tokens', component: PersonalTokensPage });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tokensRoute]),
    history: createMemoryHistory({ initialEntries: ['/settings/tokens'] }),
    context: { auth } satisfies RouterContext,
  });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

beforeEach(() => {
  resetConfigForTests();
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example',
    vite_base_uri: '/',
    vite_public_project_id: PUBLIC_PROJECT_ID,
  };
  configureGeneratedClient({ baseUrl: BASE });
  server.use(http.get(PROJECTS_PATH, () => HttpResponse.json([{ id: PUBLIC_PROJECT_ID, name: 'Public', status: 'active', suspended: false }])));
});

afterEach(() => {
  resetGeneratedClient();
  resetConfigForTests();
  delete globals['elitea_ui_config'];
});

describe('Personal Tokens — a failed read is not an empty list', () => {
  it('reports the outage instead of claiming the user has no tokens (503)', async () => {
    server.use(http.get(TOKEN_PATH, () => HttpResponse.json({ error: 'token service is not configured' }, { status: 503 })));

    mountWith('p1');

    // The query client retries a 5xx once, so give the failure time to settle.
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/turned off on this deployment/i);
    expect(screen.queryByText('No tokens yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Create token')).not.toBeInTheDocument();
  });

  it('offers a retry for a failure that could succeed later (500)', async () => {
    server.use(http.get(TOKEN_PATH, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));

    mountWith('p1');

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(screen.queryByText('No tokens yet')).not.toBeInTheDocument();
  });

  it('says the personal project is missing rather than showing the empty state', async () => {
    server.use(http.get(TOKEN_PATH, () => HttpResponse.json([])));

    mountWith(undefined);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no personal project/i);
    expect(screen.queryByText('No tokens yet')).not.toBeInTheDocument();
  });

  it('still shows the empty state for a genuinely empty list', async () => {
    server.use(http.get(TOKEN_PATH, () => HttpResponse.json([])));

    mountWith('p1');

    expect(await screen.findByText('No tokens yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
