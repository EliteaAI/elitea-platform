/**
 * tokens.test.tsx — the personal-token list must say what each key bills
 * (`spec-llm-project-scope` §4: `GET /auth/token/` now returns `project_id`,
 * JSON `null` when the key is unbound).
 *
 * Three states share one column, and the failure mode of each is different:
 *
 *  - BOUND, project known -> the project NAME, resolved through the app's
 *    existing projects query, which the route reads and passes down.
 *  - BOUND, project unknown to the caller -> the project ID. A key can outlive
 *    the caller's membership of the project it bills, so "the name did not
 *    resolve" must not erase the fact that a binding exists.
 *  - UNBOUND -> the word "Not bound". Never an empty cell: blank cannot be
 *    told apart from a name that failed to load, which is exactly the
 *    distinction a user checks this column to make.
 *
 * Minimal hand-built router tree, for the reason `notifications.test.tsx`
 * documents: the real tree redirects away from any `/settings/*` leaf that
 * declares no `$tab` param.
 */
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext, RouterContext } from '@/app/router-context';
import { AppProviders } from '@/app/providers/AppProviders';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';

import { server } from '../../../test/setup';
import { PersonalTokensPage } from '@/routes/-pages/PersonalTokens';

const BASE = '/api/v2';
const PUBLIC_PROJECT_ID = '1';
const TOKEN_PATH = `${BASE}/auth/token/`;
const PROJECTS_PATH = `${BASE}/projects/project/default/${PUBLIC_PROJECT_ID}`;

const globals = globalThis as unknown as Record<string, unknown>;

const auth: AuthContext = {
  getUser: () => ({ id: 'u1', personal_project_id: 'p1', permissions: [], publicPermissions: [] }),
  getSelectedProjectId: () => '',
};

const rootRoute = createRootRoute();
const tokensRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/tokens',
  component: PersonalTokensPage,
});
const testRouteTree = rootRoute.addChildren([tokensRoute]);

function mount(): void {
  const history = createMemoryHistory({ initialEntries: ['/settings/tokens'] });
  const router = createRouter({ routeTree: testRouteTree, history, context: { auth } satisfies RouterContext });
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
  server.use(
    http.get(PROJECTS_PATH, () =>
      HttpResponse.json([
        { id: PUBLIC_PROJECT_ID, name: 'Public', status: 'active', suspended: false },
        { id: '42', name: 'Marketing', status: 'active', suspended: false },
      ]),
    ),
    /*
     * A BARE array, not `{data: […]}`. `eliteaFetch` builds the
     * `{data, status, headers}` envelope itself out of the raw body, and
     * `tokenApi`'s `fetchJson` unwraps exactly that one envelope — so what a
     * handler returns here is what `listTokens` resolves with.
     */
    http.get(TOKEN_PATH, () =>
      HttpResponse.json([
        { uuid: 'a', name: 'bound-known', token: 'aaaabbbb', expires: null, project_id: 42 },
        { uuid: 'b', name: 'unbound', token: 'ccccdddd', expires: null, project_id: null },
        { uuid: 'c', name: 'legacy-record', token: 'eeeeffff', expires: null },
        { uuid: 'd', name: 'bound-unknown', token: 'gggghhhh', expires: null, project_id: 77 },
      ]),
    ),
  );
});

afterEach(() => {
  resetGeneratedClient();
  resetConfigForTests();
  delete globals['elitea_ui_config'];
});

describe('token list — project binding column', () => {
  it('names the bound project when the projects query knows it', async () => {
    mount();

    expect(await screen.findByText('bound-known')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
  });

  it('falls back to the project id when the caller cannot see that project', async () => {
    mount();

    expect(await screen.findByText('bound-unknown')).toBeInTheDocument();
    expect(screen.getByText('Project 77')).toBeInTheDocument();
  });

  it('reads an unbound token as "Not bound", not as an empty cell', async () => {
    mount();

    expect(await screen.findByText('unbound')).toBeInTheDocument();
    // `project_id: null` AND a record with no `project_id` field at all.
    expect(screen.getAllByText('Not bound')).toHaveLength(2);
  });

  it('gives the column a header so the value is readable as a binding', async () => {
    mount();

    expect(await screen.findByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
  });
});
