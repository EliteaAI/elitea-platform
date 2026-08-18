import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { getCreateApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { CreateApplication } from './CreateApplication';
import { renderAgentsRoute } from './__tests__/testRouter';

/** Fills the required Name/Description fields so Save becomes enabled, then clicks it. */
async function fillAndSave(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const saveButton = await screen.findByTestId('agent-save-button');
  await waitFor(() => expect(saveButton).toBeDisabled());

  await user.type(screen.getByTestId('agent-name-input'), 'My Agent');
  await user.type(screen.getByTestId('agent-description-input'), 'A description');
  await waitFor(() => expect(saveButton).not.toBeDisabled());

  await user.click(saveButton);
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('CreateApplication', () => {
  it('renders the Save/Cancel tab bar and the real CreateAgentForm (name/description fields)', async () => {
    renderAgentsRoute(<CreateApplication />, '/agents/create', { projectId: '1' });

    expect(await screen.findByTestId('agent-save-button')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByTestId('agent-name-input')).toBeInTheDocument();
  });

  it('typing into the CreateAgentForm name field enables Save once name/description are both filled', async () => {
    const user = userEvent.setup();
    renderAgentsRoute(<CreateApplication />, '/agents/create', { projectId: '1' });

    const saveButton = await screen.findByTestId('agent-save-button');
    await waitFor(() => expect(saveButton).toBeDisabled());

    await user.type(screen.getByTestId('agent-name-input'), 'My Agent');
    await user.type(screen.getByTestId('agent-description-input'), 'A description');

    await waitFor(() => expect(saveButton).not.toBeDisabled());
    // [F2] explicit timeout, not the 5000ms default: two userEvent.type()
    // calls simulate 22 real keystrokes, each round-tripping through React
    // state — legitimately slower than 5s under CI's shared runners when
    // this test lands near the tail of the full, highly-parallel suite run
    // (observed: PR #21's first batch-2 run, real timeout at 5000ms).
  }, 15_000);

  it('clicking Cancel opens a confirm dialog, and confirming navigates back to /agents/:tab', async () => {
    const user = userEvent.setup();
    const { router } = renderAgentsRoute(<CreateApplication />, '/agents/create', { projectId: '1' });

    await user.click(await screen.findByText('Cancel'));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/agents/latest'));
  });

  it('the Save button starts disabled (name/description are required and start empty) and never calls the create endpoint', async () => {
    const createSpy = vi.fn(() => ({
      id: '1',
      name: '',
      description: '',
      type: 'interface',
      icon: '',
      owner_id: 'user-1',
      created_at: '2026-01-01T00:00:00Z',
    }));
    server.use(getCreateApplicationMockHandler(createSpy));
    const { router } = renderAgentsRoute(<CreateApplication />, '/agents/create', { projectId: '1' });

    const saveButton = await screen.findByTestId('agent-save-button');
    await waitFor(() => expect(saveButton).toBeDisabled());

    expect(router.state.location.pathname).toBe('/agents/create');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('shows a generic error message when create fails with a non-field-shaped error body', async () => {
    server.use(
      http.post('*/elitea_core/applications/prompt_lib/:projectId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderAgentsRoute(<CreateApplication />, '/agents/create', { projectId: '1' });

    await fillAndSave(user);

    expect(await screen.findByText('Failed to create the agent.')).toBeInTheDocument();
  }, 15_000);

  it('attributes a duplicate-name conflict to the Name field instead of showing one generic message — old app: useCreateApplication.jsx:85-107\'s formik.setFieldError', async () => {
    server.use(
      http.post('*/elitea_core/applications/prompt_lib/:projectId', () =>
        HttpResponse.json([{ loc: ['body', 'name'], msg: 'An agent with this name already exists.' }], {
          status: 400,
        }),
      ),
    );
    const user = userEvent.setup();
    renderAgentsRoute(<CreateApplication />, '/agents/create', { projectId: '1' });

    await fillAndSave(user);

    expect(await screen.findByText('Name: An agent with this name already exists.')).toBeInTheDocument();
    expect(screen.queryByText('Failed to create the agent.')).not.toBeInTheDocument();
  }, 15_000);

  it('clears the create-error banner once a subsequent save succeeds', async () => {
    server.use(
      http.post('*/elitea_core/applications/prompt_lib/:projectId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderAgentsRoute(<CreateApplication />, '/agents/create', { projectId: '1' });

    await fillAndSave(user);
    await screen.findByText('Failed to create the agent.');

    server.use(
      getCreateApplicationMockHandler({
        id: '1',
        name: 'My Agent',
        description: 'A description',
        type: 'interface',
        icon: '',
        owner_id: 'user-1',
        created_at: '2026-01-01T00:00:00Z',
      }),
    );
    await user.click(screen.getByTestId('agent-save-button'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/agents/latest/1'));
  }, 15_000);

  /*
   * #307 — `CreateAgentForm` now renders the conversation-starters editor
   * itself, so this page had to route the path or the create form would ship
   * the same inert control the edit page was filed for. Asserted off the
   * POST body: the editor keeps no state of its own, so "the text is on
   * screen" would prove only that the page echoed it back.
   */
  // 15s, not the 5s default: this one test types into three fields (starter,
  // name, description) and `user.type` is per-keystroke — it passed alone and
  // timed out when the whole `pages/agents` + `features/agents` suite ran in
  // parallel on this machine.
  it('sends a conversation starter typed on the create form in the create POST body', { timeout: 15_000 }, async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('*/elitea_core/applications/prompt_lib/:projectId', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: '7', version_details: { id: '1' } }, { status: 201 });
      }),
    );
    renderAgentsRoute(<CreateApplication />, '/agents/create', { projectId: '1' });

    const add = await screen.findByTestId('agent-conversation-starter-add');
    expect(add).toBeVisible();
    await user.click(add);
    await user.type(screen.getByTestId('agent-conversation-starter-input'), 'Ask');

    await fillAndSave(user);

    await waitFor(() => expect(bodies).toHaveLength(1));
    const versions = bodies[0]?.['versions'] as Record<string, unknown>[] | undefined;
    expect(versions?.[0]?.['conversation_starters']).toEqual(['Ask']);
  });
});
