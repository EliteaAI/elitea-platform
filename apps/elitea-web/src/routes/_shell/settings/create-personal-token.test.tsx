/**
 * create-personal-token.test.tsx — the optional project binding on
 * `POST /api/v2/auth/token/` (`spec-llm-project-scope` §4, ADR-0018).
 *
 * The four things that can silently go wrong here, and are therefore pinned:
 *
 *  1. UNBOUND MUST STAY THE DEFAULT. A user who never touches the new control
 *     must send the request that shipped before the control existed — no
 *     `project_id` key at all, not `project_id: null`. Asserted on the
 *     request body's KEYS, because `toMatchObject` cannot tell an absent key
 *     from an explicit `null` one.
 *  2. Picking a project sends it, as a NUMBER (the `<select>` value is a
 *     string; the conversion happens in `onSubmit`).
 *  3/4. The 403 `project_forbidden` and 400 `invalid_project_id` failures
 *     reach the user as their own messages. Both use the NESTED envelope
 *     `{"error":{message,type,code}}`, unlike every other failure on this
 *     endpoint, which keeps the FLAT `{"error":"…"}` — the last case below
 *     feeds a flat body in to prove the flat shape still degrades to the
 *     generic line instead of throwing or rendering a project message.
 *
 * Mounts `CreatePersonalTokenPage` through a MINIMAL hand-built router tree
 * for the reason `notifications.test.tsx` documents at length: the real
 * generated tree routes `/settings/*` through `settings-layout.tsx`, whose
 * `SettingsRedirect` navigates away from any leaf that declares no `$tab`.
 */
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext, RouterContext } from '@/app/router-context';
import { AppProviders } from '@/app/providers/AppProviders';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';

import { server } from '../../../test/setup';
import { CreatePersonalTokenPage } from './create-personal-token';

const BASE = '/api/v2';
const PUBLIC_PROJECT_ID = '1';
const TOKEN_PATH = `${BASE}/auth/token/`;
const PROJECTS_PATH = `${BASE}/projects/project/default/${PUBLIC_PROJECT_ID}`;

const globals = globalThis as unknown as Record<string, unknown>;

const auth: AuthContext = {
  getUser: () => ({ id: 'u1', personal_project_id: 'p1', permissions: [], publicPermissions: [] }),
  getSelectedProjectId: () => '42',
};

const rootRoute = createRootRoute();
const createTokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/create-personal-token',
  component: CreatePersonalTokenPage,
});
const testRouteTree = rootRoute.addChildren([createTokenRoute]);

function mount(): void {
  const history = createMemoryHistory({ initialEntries: ['/settings/create-personal-token'] });
  const router = createRouter({ routeTree: testRouteTree, history, context: { auth } satisfies RouterContext });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

/** The app's existing projects query — `GET /projects/project/default/{publicProjectId}`. */
function mockProjects(): void {
  server.use(
    http.get(PROJECTS_PATH, () =>
      HttpResponse.json([
        { id: PUBLIC_PROJECT_ID, name: 'Public', status: 'active', suspended: false },
        { id: '42', name: 'Marketing', status: 'active', suspended: false },
      ]),
    ),
  );
}

/**
 * Captures every create body. Answers with the BARE record: `eliteaFetch`
 * builds the `{data, status, headers}` envelope itself and `tokenApi`'s
 * `fetchJson` unwraps that one envelope, so a handler that wraps its own
 * `{data: …}` would make `resp.token` undefined — the exact defect
 * `tokenApi.ts`'s own comment records.
 */
function mockCreateOk(): { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(TOKEN_PATH, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({
        uuid: 'tok-uuid',
        name: 'my-token',
        token: 'secret-value',
        expires: null,
        project_id: null,
      });
    }),
  );
  return { bodies };
}

function mockCreateFailure(status: number, body: Record<string, unknown>): void {
  server.use(http.post(TOKEN_PATH, () => HttpResponse.json(body, { status })));
}

/** Fills the name and presses Generate, waiting for the form to become valid first. */
async function submitWith(user: ReturnType<typeof userEvent.setup>, projectOption?: string): Promise<void> {
  // `findBy…`: the router resolves its match asynchronously, so the form is
  // not in the DOM on the tick after `render`.
  await user.type(await screen.findByLabelText('Name'), 'my-token');
  if (projectOption !== undefined) {
    // Wait for the project list before selecting from it.
    await screen.findByRole('option', { name: projectOption });
    await user.selectOptions(screen.getByLabelText('Project'), projectOption);
  }
  const generate = screen.getByRole('button', { name: 'Generate' });
  await waitFor(() => expect(generate).toBeEnabled());
  await user.click(generate);
}

beforeEach(() => {
  resetConfigForTests();
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example',
    vite_base_uri: '/',
    vite_public_project_id: PUBLIC_PROJECT_ID,
  };
  configureGeneratedClient({ baseUrl: BASE });
  mockProjects();
});

afterEach(() => {
  resetGeneratedClient();
  resetConfigForTests();
  delete globals['elitea_ui_config'];
});

describe('project binding — the default', () => {
  it('sends no project_id at all when the user ignores the project control', async () => {
    const { bodies } = mockCreateOk();
    mount();

    await submitWith(userEvent.setup());

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0]!)).not.toContain('project_id');
    expect(bodies[0]).toMatchObject({ name: 'my-token', expires: { measure: 'days', value: 30 } });
  });

  it('offers "No project (default)" as the pre-selected option', async () => {
    mount();

    const select = await screen.findByLabelText('Project');
    expect(select).toHaveValue('');
    expect(await screen.findByRole('option', { name: 'No project (default)' })).toBeInTheDocument();
  });
});

describe('project binding — a chosen project', () => {
  it('sends the selected project as a numeric project_id', async () => {
    const { bodies } = mockCreateOk();
    mount();

    await submitWith(userEvent.setup(), 'Marketing');

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ name: 'my-token', project_id: 42 });
    expect(typeof bodies[0]!['project_id']).toBe('number');
  });

  it('offers only the projects the projects query returns', async () => {
    mount();

    await screen.findByRole('option', { name: 'Marketing' });
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('Marketing');
    expect(options).toContain('Public');
    expect(options).not.toContain('Some other project');
  });
});

describe('project binding — the §4 error contract', () => {
  it('renders the membership message for a 403 project_forbidden', async () => {
    mockCreateFailure(403, {
      error: { message: 'not a member', type: 'permission_error', code: 'project_forbidden' },
    });
    mount();

    await submitWith(userEvent.setup(), 'Marketing');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'You are not a member of this project. Select a different project, or create the token with no project.',
    );
  });

  it('renders the malformed-project message for a 400 invalid_project_id', async () => {
    mockCreateFailure(400, {
      error: { message: 'bad project id', type: 'invalid_request_error', code: 'invalid_project_id' },
    });
    mount();

    await submitWith(userEvent.setup(), 'Marketing');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This project is not a valid choice. Select a project from the list again.');
  });

  it('falls back to the generic message for the FLAT error envelope every other failure uses', async () => {
    mockCreateFailure(500, { error: 'internal server error' });
    mount();

    await submitWith(userEvent.setup());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The system did not create the token. Try again.');
  });
});
