import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
