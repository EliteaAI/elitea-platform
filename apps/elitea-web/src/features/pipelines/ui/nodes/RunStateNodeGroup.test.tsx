import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { RunStateNodeGroup, type RunStateGraphNode } from './RunStateNodeGroup';

const yamlJsonObject: YamlPipelineDocument = {};

function renderGroup(nodes: readonly RunStateGraphNode[]) {
  return renderWithTheme(
    <RunStateNodeGroup
      nodes={nodes}
      deleteRunNode={vi.fn()}
      handleStopRun={vi.fn()}
      yamlJsonObject={yamlJsonObject}
    />,
  );
}

describe('RunStateNodeGroup', () => {
  // Reproduces the confirmed LOW-MEDIUM finding: `nodes` must stay the
  // baseline's own node-shaped contract (`{id, data: {status, label}}`,
  // `RunStateNodeGroup.jsx:16-33`'s `{...onlyNode}` spread), matching
  // `./RunStateNode.tsx`'s own `id`/`data`/`selected` props exactly. The
  // undisclosed flat-entry redesign this replaces (`data={onlyNode}` instead
  // of `data={onlyNode.data}`) fed the whole node object -- `{id, data}` --
  // straight into `RunStateNode`'s `data` prop, so `data.status` was
  // `undefined` there and `RunStateNode`'s own tooltip title
  // (`data.status.toLowerCase()`) threw a TypeError on render.
  it('renders a single run node using its own nested data, not the outer node object', () => {
    const nodes: readonly RunStateGraphNode[] = [{ id: 'run-1', data: { status: 'Completed', label: 'Run 1' } }];
    expect(() => renderGroup(nodes)).not.toThrow();
    expect(screen.getByText('Run 1')).toBeInTheDocument();
  });

  it('renders the last run node (of several) using its own nested data', () => {
    const nodes: readonly RunStateGraphNode[] = [
      { id: 'run-1', data: { status: 'Completed', label: 'Run 1' } },
      { id: 'run-2', data: { status: 'Error', label: 'Run 2' } },
    ];
    expect(() => renderGroup(nodes)).not.toThrow();
    expect(screen.getByText('Run 2')).toBeInTheDocument();
    expect(screen.queryByText('Run 1')).not.toBeInTheDocument();
  });
});
