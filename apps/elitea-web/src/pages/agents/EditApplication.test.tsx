import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { getGetApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';

import { EditApplication } from './EditApplication';
import { renderAgentsRoute } from './__tests__/testRouter';

const globals = globalThis as unknown as Record<string, unknown>;

/** Same fixture shape `lib/isPublicAgentsProject.test.ts` already establishes for this exact config surface. */
function setPublicProjectId(publicProjectId: string): void {
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example',
    vite_base_uri: '/',
    vite_public_project_id: publicProjectId,
  };
  resetConfigForTests();
}

function detail(overrides: { versions?: { id: string; name: string; status: string; agent_type: string; created_at: string }[] } = {}) {
  return {
    id: '42',
    name: 'My Agent',
    description: 'A helpful agent',
    icon: '',
    owner_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    versions: overrides.versions ?? [
      { id: '1', name: 'base', status: 'draft', agent_type: 'classic', created_at: '2026-01-01T00:00:00Z' },
    ],
    version_details: {
      id: '1',
      application_id: '42',
      name: 'base',
      status: 'draft',
      instructions: 'Be helpful.',
      conversation_starters: ['Hi there'],
    },
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
  delete globals['elitea_ui_config'];
  resetConfigForTests();
});

describe('EditApplication', () => {
  it('renders the application name once it loads', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });

    // 5s, not the 1s default: the configuration panel now renders the real
    // `CreateAgentForm` (several MUI accordions) instead of an empty Box, so the
    // first paint is much heavier. This passed locally and failed on CI at the
    // default timeout, with the DOM showing the fallback `<h3>Agent</h3>` — the
    // query had simply not resolved yet. The assertion is unchanged; only the
    // wait is realistic for a slower machine.
    expect(await screen.findByText('My Agent', {}, { timeout: 5_000 })).toBeInTheDocument();
  });

  it('renders the configuration tab panel with the real agent fields in it', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });

    // Asserting the panel is `toBeInTheDocument()` is what let this page ship a
    // self-closing `<Box data-testid=… />` for so long — an empty div is in the
    // document. Assert it CONTAINS the fields, so a hollow panel fails here
    // rather than waiting for an E2E journey to notice.
    const panel = await screen.findByTestId('edit-application-configuration-tab-panel', {}, { timeout: 5_000 });
    expect(await screen.findByTestId('agent-name-input', {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(panel).toContainElement(screen.getByTestId('agent-name-input'));
    expect(panel).toContainElement(screen.getByTestId('agent-description-input'));
  });

  it('shows the not-found state when the URL version is not in the versions list', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderAgentsRoute(<EditApplication />, '/agents/all/42/999', { projectId: '9' });

    expect(await screen.findByText('Version not found')).toBeInTheDocument();
  });

  it('skips the not-found check when isFromCreation=true', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    // Navigated to imperatively (rather than embedding `?isFromCreation=true`
    // directly in the initial memory-history entry) so the query string goes
    // through TanStack Router's own typed `navigate()` — the same API this
    // unit's pages themselves use — instead of relying on how
    // `createMemoryHistory`'s `initialEntries` parses a combined path+query
    // string, which this fixture found does NOT reliably populate
    // `location.search` for a cold `initialEntries` string.
    const { router } = renderAgentsRoute(<EditApplication />, '/agents/all/42/999', { projectId: '9' });
    await waitFor(() => expect(screen.getByText('Version not found')).toBeInTheDocument());

    await router.navigate({
      to: '/agents/$tab/$agentId/$version',
      params: { tab: 'all', agentId: '42', version: '999' },
      search: { isFromCreation: 'true' },
      replace: true,
    });

    await waitFor(() => expect(screen.getByText('My Agent')).toBeInTheDocument());
    expect(screen.queryByText('Version not found')).not.toBeInTheDocument();
  });

  it('renders the Save/Cancel bar once loaded', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });

    expect(await screen.findByTestId('agent-save-button')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  /*
   * #134 — the page fetched `versions[]` and spent it exclusively on
   * `useIsVersionNotFound`'s 404 check; nothing on screen ever showed a
   * version. Both of these assert on the MOUNTED control, not on a component
   * existing somewhere in the tree, which is precisely the distinction that
   * the dead `SaveNewVersionButton` (zero importers) slipped through.
   */
  it('mounts the version selector and lists the agent\'s versions', async () => {
    server.use(
      getGetApplicationMockHandler(
        detail({
          versions: [
            { id: '1', name: 'base', status: 'draft', agent_type: 'classic', created_at: '2026-01-01T00:00:00Z' },
            { id: '2', name: 'v1', status: 'draft', agent_type: 'classic', created_at: '2026-01-02T00:00:00Z' },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });

    await user.click(await screen.findByTestId('version-selector-trigger', {}, { timeout: 5_000 }));

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('base'),
      expect.stringContaining('v1'),
    ]);
  });

  it('mounts "Save As Version" for an owner and withholds it from a read-only viewer', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    const owner = renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });
    expect(await owner.findByRole('button', { name: /save as version/i }, { timeout: 5_000 })).toBeInTheDocument();
    owner.unmount();

    setPublicProjectId('9');
    const viewer = renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });
    await viewer.findByTestId('version-selector-trigger', {}, { timeout: 5_000 });
    expect(viewer.queryByRole('button', { name: /save as version/i })).not.toBeInTheDocument();
  });

  it('clicking Cancel does not throw and keeps the page mounted', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    const user = userEvent.setup();
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });

    await screen.findByText('Cancel');
    await user.click(screen.getByText('Cancel'));

    await waitFor(() => expect(screen.getByTestId('edit-application-configuration-tab-panel')).toBeInTheDocument());
  });

  it('hides the Save/Cancel bar for a read-only viewer of a public agent (viewing under the public project)', async () => {
    setPublicProjectId('42');
    server.use(getGetApplicationMockHandler(detail()));
    renderAgentsRoute(<EditApplication />, '/agents/latest/42', { projectId: '42' });

    await screen.findByText('My Agent');
    expect(screen.queryByTestId('agent-save-button')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('still renders the Save/Cancel bar for the same agent when the selected project is NOT the public project', async () => {
    setPublicProjectId('42');
    server.use(getGetApplicationMockHandler(detail()));
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });

    expect(await screen.findByTestId('agent-save-button')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows a dedicated not-found page when the application-detail fetch 404s (e.g. a deleted/nonexistent agent)', async () => {
    server.use(
      http.get('*/elitea_core/application/prompt_lib/:projectId/:applicationId', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );
    renderAgentsRoute(<EditApplication />, '/agents/all/999', { projectId: '9' });

    expect(await screen.findByText('Agent not found')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-save-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-application-configuration-tab-panel')).not.toBeInTheDocument();
  });

  it('shows a save-error banner (instead of nothing) when a save attempt fails', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });
    const user = userEvent.setup();

    const saveButton = await screen.findByTestId('agent-save-button');
    server.use(
      http.put('*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    await user.click(saveButton);

    expect(await screen.findByText('Failed to save your changes.')).toBeInTheDocument();
  });
});
