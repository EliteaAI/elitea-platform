import { fireEvent, screen, waitFor } from '@testing-library/react';
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

  it('renders nothing when nodes is empty', () => {
    const { container } = renderGroup([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the history clock affordance and the last run node once there is more than one run', () => {
    const nodes: readonly RunStateGraphNode[] = [
      { id: 'run-1', data: { status: 'Completed', label: 'Run 1' } },
      { id: 'run-2', data: { status: 'Error', label: 'Run 2' } },
    ];
    const { container } = renderGroup(nodes);
    // The history-menu trigger box -- present only in the multi-node branch
    // (the single-node branch returns a bare `RunStateNode`, no wrapper Box).
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('Run 2')).toBeInTheDocument();
  });

  it('opens the history menu on click and lists every run except the last one', async () => {
    const nodes: readonly RunStateGraphNode[] = [
      { id: 'run-1', data: { status: 'Completed', label: 'Run 1' } },
      { id: 'run-2', data: { status: 'In progress', label: 'Run 2' } },
      { id: 'run-3', data: { status: 'Error', label: 'Run 3' } },
    ];
    const { container } = renderGroup(nodes);

    const historyTrigger = container.querySelector('svg')?.closest('div');
    expect(historyTrigger).toBeTruthy();
    fireEvent.click(historyTrigger as HTMLElement);

    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
    expect(screen.getByText('Run 1')).toBeInTheDocument();
    expect(screen.getByText('Run 2')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    // 'Run 3' (the last node) is rendered outside the menu, not as a history entry.
    const menu = screen.getByRole('menu');
    expect(menu).not.toHaveTextContent('Run 3');
  });

  it('closes the history menu when it is dismissed', async () => {
    const nodes: readonly RunStateGraphNode[] = [
      { id: 'run-1', data: { status: 'Completed', label: 'Run 1' } },
      { id: 'run-2', data: { status: 'Error', label: 'Run 2' } },
    ];
    const { container } = renderGroup(nodes);

    const historyTrigger = container.querySelector('svg')?.closest('div');
    fireEvent.click(historyTrigger as HTMLElement);
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());

    // MUI `Menu` closes on an Escape keydown against the open menu's list.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('forwards editorHeight/editorWidth to each rendered RunStateNode without throwing', () => {
    const nodes: readonly RunStateGraphNode[] = [{ id: 'run-1', data: { status: 'Completed', label: 'Run 1' } }];
    expect(() =>
      renderWithTheme(
        <RunStateNodeGroup
          nodes={nodes}
          deleteRunNode={vi.fn()}
          handleStopRun={vi.fn()}
          yamlJsonObject={yamlJsonObject}
          editorHeight={300}
          editorWidth={500}
        />,
      ),
    ).not.toThrow();
  });
});
