import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { getGetApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { EditApplication } from './EditApplication';
import { renderAgentsRoute } from './__tests__/testRouter';

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
});

describe('EditApplication', () => {
  it('renders the application name once it loads', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });

    expect(await screen.findByText('My Agent')).toBeInTheDocument();
  });

  it('renders the (composition-gap) configuration tab panel', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });

    expect(await screen.findByTestId('edit-application-configuration-tab-panel')).toBeInTheDocument();
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

  it('clicking Cancel does not throw and keeps the page mounted', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    const user = userEvent.setup();
    renderAgentsRoute(<EditApplication />, '/agents/all/42', { projectId: '9' });

    await screen.findByText('Cancel');
    await user.click(screen.getByText('Cancel'));

    await waitFor(() => expect(screen.getByTestId('edit-application-configuration-tab-panel')).toBeInTheDocument());
  });
});
