import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { FlowGraphEdge, FlowGraphNode } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import { ConditionOutputsList } from './ConditionOutputsList';

const nodes: readonly FlowGraphNode[] = [
  { id: 'condition-1', position: { x: 0, y: 0 } },
  { id: 'branch-a', position: { x: 0, y: 0 } },
  { id: 'branch-b', position: { x: 0, y: 0 } },
];

describe('ConditionOutputsList', () => {
  it('renders one chip per conditional output', () => {
    renderWithTheme(
      <ConditionOutputsList
        id="condition-1"
        conditionOutput={['branch-a', 'branch-b']}
        onRemoveOutput={() => () => {}}
        edges={[]}
        nodes={nodes}
      />,
    );

    expect(screen.getByText('branch-a')).toBeInTheDocument();
    expect(screen.getByText('branch-b')).toBeInTheDocument();
  });

  it("marks an output whose target node doesn't exist as rejected, with the matching tooltip", async () => {
    renderWithTheme(
      <ConditionOutputsList
        id="condition-1"
        conditionOutput={['missing-branch']}
        onRemoveOutput={() => () => {}}
        edges={[]}
        nodes={nodes}
      />,
    );

    const chip = screen.getByText('missing-branch').closest('[class*="MuiChip-root"]') as HTMLElement;
    fireEvent.mouseOver(chip);
    expect(await screen.findByText("Corresponding node doesn't exist")).toBeInTheDocument();
  });

  it('marks an output connected by an edge as published, with an empty tooltip', () => {
    const edges: readonly FlowGraphEdge[] = [{ id: 'e1', source: 'condition-1', target: 'branch-a' }];
    renderWithTheme(
      <ConditionOutputsList
        id="condition-1"
        conditionOutput={['branch-a']}
        onRemoveOutput={() => () => {}}
        edges={edges}
        nodes={nodes}
      />,
    );

    expect(screen.getByText('branch-a')).toBeInTheDocument();
  });

  it('marks an existing but unconnected output as onModeration, with the matching tooltip', async () => {
    renderWithTheme(
      <ConditionOutputsList
        id="condition-1"
        conditionOutput={['branch-b']}
        onRemoveOutput={() => () => {}}
        edges={[]}
        nodes={nodes}
      />,
    );

    const chip = screen.getByText('branch-b').closest('[class*="MuiChip-root"]') as HTMLElement;
    fireEvent.mouseOver(chip);
    expect(await screen.findByText('Not connected to the corresponding node')).toBeInTheDocument();
  });

  it('calls onRemoveOutput(item)() when the chip delete icon is clicked', () => {
    const onRemoveOutputForItem = vi.fn();
    const onRemoveOutput = vi.fn().mockReturnValue(onRemoveOutputForItem);

    renderWithTheme(
      <ConditionOutputsList
        id="condition-1"
        conditionOutput={['branch-a']}
        onRemoveOutput={onRemoveOutput}
        edges={[]}
        nodes={nodes}
      />,
    );

    const chip = screen.getByText('branch-a').closest('[class*="MuiChip-root"]') as HTMLElement;
    fireEvent.click(within(chip).getByTestId('condition-output-remove'));

    expect(onRemoveOutput).toHaveBeenCalledWith('branch-a');
    expect(onRemoveOutputForItem).toHaveBeenCalledTimes(1);
  });

  it('renders no chips when conditionOutput is empty', () => {
    const { container } = renderWithTheme(
      <ConditionOutputsList
        id="condition-1"
        conditionOutput={[]}
        onRemoveOutput={() => () => {}}
        edges={[]}
        nodes={nodes}
      />,
    );

    expect(container.querySelectorAll('[class*="MuiChip-root"]')).toHaveLength(0);
  });
});
