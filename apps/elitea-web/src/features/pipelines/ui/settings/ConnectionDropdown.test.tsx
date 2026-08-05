import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import type { FlowNode } from '../../lib/flow-editor/reactFlowTypes';
import { ConnectionDropdown } from './ConnectionDropdown';

function makeTargetNode(id: string, type: string, label?: string): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: label !== undefined ? { label } : {} };
}

describe('ConnectionDropdown', () => {
  it('renders nothing when closed', () => {
    renderWithTheme(
      <ConnectionDropdown
        open={false}
        anchorPosition={{ x: 10, y: 10 }}
        targetNodes={[]}
        onNodeSelect={vi.fn()}
        onNodeCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders nothing when open but there is no anchor at all', () => {
    renderWithTheme(
      <ConnectionDropdown
        open
        anchorPosition={null}
        targetNodes={[]}
        onNodeSelect={vi.fn()}
        onNodeCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists existing target nodes plus a "Create new node" entry when targets exist', () => {
    const target = makeTargetNode('node-2', 'agent', 'My Agent');
    renderWithTheme(
      <ConnectionDropdown
        open
        anchorPosition={{ x: 10, y: 10 }}
        targetNodes={[target]}
        onNodeSelect={vi.fn()}
        onNodeCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Create new node')).toBeInTheDocument();
    expect(screen.getByText('My Agent')).toBeInTheDocument();
  });

  it('falls straight into the node-creation grid when there are no existing targets', () => {
    renderWithTheme(
      <ConnectionDropdown
        open
        anchorPosition={{ x: 10, y: 10 }}
        targetNodes={[]}
        availableNodeTypes={['agent', 'llm']}
        onNodeSelect={vi.fn()}
        onNodeCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Create new node')).not.toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('LLM')).toBeInTheDocument();
  });

  it('calls onNodeSelect then onClose when an existing target is clicked', async () => {
    const user = userEvent.setup();
    const onNodeSelect = vi.fn();
    const onClose = vi.fn();
    const target = makeTargetNode('node-2', 'agent', 'My Agent');
    renderWithTheme(
      <ConnectionDropdown
        open
        anchorPosition={{ x: 10, y: 10 }}
        targetNodes={[target]}
        onNodeSelect={onNodeSelect}
        onNodeCreate={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByText('My Agent'));

    expect(onNodeSelect).toHaveBeenCalledWith(target);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onNodeCreate then onClose when a node type is picked from the grid', async () => {
    const user = userEvent.setup();
    const onNodeCreate = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <ConnectionDropdown
        open
        anchorPosition={{ x: 10, y: 10 }}
        targetNodes={[]}
        availableNodeTypes={['agent']}
        onNodeSelect={vi.fn()}
        onNodeCreate={onNodeCreate}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByText('Agent'));

    expect(onNodeCreate).toHaveBeenCalledWith('agent');
    expect(onClose).toHaveBeenCalled();
  });

  it('switches into the node-creation grid when "Create new node" is clicked', async () => {
    const user = userEvent.setup();
    const target = makeTargetNode('node-2', 'agent', 'My Agent');
    renderWithTheme(
      <ConnectionDropdown
        open
        anchorPosition={{ x: 10, y: 10 }}
        targetNodes={[target]}
        availableNodeTypes={['llm']}
        onNodeSelect={vi.fn()}
        onNodeCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByText('Create new node'));

    expect(screen.getByText('LLM')).toBeInTheDocument();
    expect(screen.queryByText('My Agent')).not.toBeInTheDocument();
  });

  it('opens straight into node creation when forceNodeCreation is set even with existing targets', () => {
    const target = makeTargetNode('node-2', 'agent', 'My Agent');
    renderWithTheme(
      <ConnectionDropdown
        open
        forceNodeCreation
        anchorPosition={{ x: 10, y: 10 }}
        targetNodes={[target]}
        availableNodeTypes={['llm']}
        onNodeSelect={vi.fn()}
        onNodeCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('LLM')).toBeInTheDocument();
    expect(screen.queryByText('My Agent')).not.toBeInTheDocument();
  });

  it('falls back to the node id when a target has no data.label', () => {
    const target = makeTargetNode('node-3', 'llm');
    renderWithTheme(
      <ConnectionDropdown
        open
        anchorPosition={{ x: 10, y: 10 }}
        targetNodes={[target]}
        onNodeSelect={vi.fn()}
        onNodeCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('node-3')).toBeInTheDocument();
  });
});
