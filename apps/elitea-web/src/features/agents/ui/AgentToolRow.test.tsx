import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import type { AgentToolAssociation } from '../lib/types';

import { renderWithRouterAndProject } from '../__tests__/testUtils';

import { AgentToolRow } from './AgentToolRow';

/**
 * #248, the withheld half. `ToolCard` still SUPPORTS a variables control —
 * `ToolCard.test.tsx` covers that path — so the only thing that can prove the
 * agent Tools panel does not offer it is a test of the composition that
 * decides: this row.
 *
 * The fixture tool deliberately CARRIES variables. A row that forwarded them
 * (as this one did until #248) renders a "Show variables" toggle and, behind
 * it, real editable inputs whose every keystroke went to in-memory state and
 * nowhere else — there is no column, no table and no `tools` branch in
 * `UpdateVersion` that could store them.
 */
const TOOL_WITH_VARIABLES: AgentToolAssociation = {
  id: 'tool-1',
  tool_id: 77,
  type: 'custom',
  name: 'Github',
  settings: {},
  variables: [{ name: 'TOKEN', value: 'abc' }],
};

function renderRow() {
  return renderWithRouterAndProject(
    <AgentToolRow
      tool={TOOL_WITH_VARIABLES}
      index={0}
      isDuplicate={false}
      disabled={false}
      viewMode="owner"
      entity={{ applicationId: 42, versionId: 100, projectId: 'proj-1' }}
      toolsState={{ tools: [TOOL_WITH_VARIABLES], initialTools: [TOOL_WITH_VARIABLES], dirty: false, onToolsChange: vi.fn(), onToolRemoved: vi.fn() }}
    />,
    'proj-1',
  );
}

describe('AgentToolRow', () => {
  it('offers NO per-tool variables control, even for a tool that carries variables', async () => {
    renderRow();

    // The card really did mount — otherwise every absence assertion below is
    // vacuously true, which is how a hollow panel passed once before.
    expect(await screen.findByTestId('agent-toolkit-card')).toBeVisible();

    expect(screen.queryByText('Show variables')).not.toBeInTheDocument();
    expect(screen.queryByText('Hide variables')).not.toBeInTheDocument();
    // The panel and its editable field, not merely the toggle: an assertion on
    // the toggle alone would pass against a card that still rendered inputs.
    expect(screen.queryByTestId('agent-variables')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('TOKEN')).not.toBeInTheDocument();
  });
});


/**
 * The guardrails blocklist reaching the card.
 *
 * `ToolCard` has always been able to render the "blocked by your organization"
 * banner, and `ToolCard.test.tsx` covered it by passing `blockedToolkitTypes`
 * directly. What could not be covered was the COMPOSITION: no production caller
 * ever supplied that field, so `isBlockedToolkit` was structurally always false
 * and the banner was unreachable on every real screen. These two cases are the
 * regression guard for exactly that — they fail if the prop is dropped again,
 * which the ToolCard-level test cannot notice.
 */
const SETTINGS_URL = '/api/v2/elitea_core/platform_settings/prompt_lib';

const PLATFORM_SETTINGS = {
  chat_enabled: true,
  applications_enabled: true,
  skills_enabled: true,
  toolkits_enabled: true,
  datasources_enabled: true,
  pipelines_enabled: true,
  publishing_enabled: true,
  moderation_enabled: true,
  mcp_enabled: true,
  support_chat_enabled: true,
};

const GITHUB_TOOL: AgentToolAssociation = {
  id: 'tool-2',
  tool_id: 78,
  type: 'github',
  name: 'Team repo',
  settings: {},
};

function renderToolOfType(tool: AgentToolAssociation) {
  return renderWithRouterAndProject(
    <AgentToolRow
      tool={tool}
      index={0}
      isDuplicate={false}
      disabled={false}
      viewMode="owner"
      entity={{ applicationId: 42, versionId: 100, projectId: 'proj-1' }}
      toolsState={{ tools: [tool], initialTools: [tool], dirty: false, onToolsChange: vi.fn(), onToolRemoved: vi.fn() }}
    />,
    'proj-1',
  );
}

describe('the guardrails blocklist', () => {
  beforeEach(() => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
  });

  afterEach(() => {
    resetGeneratedClient();
  });

  it('marks a toolkit whose type the admin blocked', async () => {
    // Published in a different naming style from the tool's own type, so this
    // fails if the row forwards the list without the canonical matcher.
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json({ ...PLATFORM_SETTINGS, blocked_toolkits: ['Git-Hub'] })));

    renderToolOfType(GITHUB_TOOL);
    await waitFor(() => {
      expect(screen.getByText(/blocked by your organization/i)).toBeInTheDocument();
    });
  });

  it('leaves an unblocked toolkit alone', async () => {
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json({ ...PLATFORM_SETTINGS, blocked_toolkits: ['shell'] })));

    renderToolOfType(GITHUB_TOOL);
    // Settled: the banner's absence has to outlive the query resolving, or this
    // would pass against a row that never reads the list at all.
    await waitFor(() => {
      expect(screen.getByText(/Team repo/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/blocked by your organization/i)).not.toBeInTheDocument();
  });
});
