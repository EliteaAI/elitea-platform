import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { YamlPipelineDocument } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { FlowNode } from '../../../lib/flow-editor/reactFlowTypes';
import { NodeCardHeader, type NodeCardHeaderProps } from './NodeCardHeader';

function baseProps(overrides: Partial<NodeCardHeaderProps> = {}): NodeCardHeaderProps {
  const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'Tool 1' }] };
  return {
    name: 'Tool 1',
    isEntrypoint: false,
    isExpanded: true,
    onExpand: vi.fn(),
    type: 'tool',
    id: 'Tool 1',
    yamlJsonObject,
    setYamlJsonObject: vi.fn(),
    setFlowNodes: vi.fn(),
    setFlowEdges: vi.fn(),
    handleDeleteNode: vi.fn(),
    ...overrides,
  };
}

describe('NodeCardHeader', () => {
  it('renders the node name', () => {
    renderWithTheme(<NodeCardHeader {...baseProps()} />);
    expect(screen.getByText('Tool 1')).toBeInTheDocument();
  });

  it('shows the entrypoint icon only when isEntrypoint is true', () => {
    const { container: withoutEntrypoint } = renderWithTheme(
      <NodeCardHeader {...baseProps({ isEntrypoint: false })} />,
    );
    const withoutCount = withoutEntrypoint.querySelectorAll('svg').length;

    const { container: withEntrypoint } = renderWithTheme(<NodeCardHeader {...baseProps({ isEntrypoint: true })} />);
    const withCount = withEntrypoint.querySelectorAll('svg').length;

    expect(withCount).toBeGreaterThan(withoutCount);
  });

  it('calls onExpand(false) when the expand/collapse button is clicked while expanded', () => {
    const onExpand = vi.fn();
    renderWithTheme(<NodeCardHeader {...baseProps({ isExpanded: true, onExpand })} />);

    fireEvent.click(screen.getByRole('button', { name: '' }));

    expect(onExpand).toHaveBeenCalledWith(false);
  });

  it('does not call onExpand when isRunningPipeline is true', () => {
    const onExpand = vi.fn();
    renderWithTheme(<NodeCardHeader {...baseProps({ onExpand, isRunningPipeline: true })} />);

    fireEvent.click(screen.getByRole('button', { name: '' }));

    expect(onExpand).not.toHaveBeenCalled();
  });

  it('does not render the node-actions dropdown when collapsed', () => {
    renderWithTheme(<NodeCardHeader {...baseProps({ isExpanded: false })} />);
    expect(screen.queryByRole('button', { name: 'Node actions' })).not.toBeInTheDocument();
  });

  it('renders the node-actions dropdown when expanded', () => {
    renderWithTheme(<NodeCardHeader {...baseProps({ isExpanded: true })} />);
    expect(screen.getByRole('button', { name: 'Node actions' })).toBeInTheDocument();
  });

  it('offers "Make entrypoint" for a non-entrypoint, non-Condition/Decision node', async () => {
    renderWithTheme(<NodeCardHeader {...baseProps({ isEntrypoint: false, type: 'tool' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Node actions' }));
    expect(await screen.findByText('Make entrypoint')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('omits "Make entrypoint" once the node is already the entrypoint', async () => {
    renderWithTheme(<NodeCardHeader {...baseProps({ isEntrypoint: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Node actions' }));
    expect(await screen.findByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Make entrypoint')).not.toBeInTheDocument();
  });

  it('omits "Make entrypoint" for a Condition node', async () => {
    renderWithTheme(<NodeCardHeader {...baseProps({ isEntrypoint: false, type: 'condition' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Node actions' }));
    expect(await screen.findByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Make entrypoint')).not.toBeInTheDocument();
  });

  it('calls handleDeleteNode with the node id when Delete is clicked', async () => {
    const handleDeleteNode = vi.fn();
    renderWithTheme(<NodeCardHeader {...baseProps({ id: 'Tool 1', handleDeleteNode })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Node actions' }));
    fireEvent.click(await screen.findByText('Delete'));
    expect(handleDeleteNode).toHaveBeenCalledWith('Tool 1');
  });

  it('calls setYamlJsonObject with entry_point set to the node name on "Make entrypoint"', async () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'Tool 1' }] };
    renderWithTheme(
      <NodeCardHeader {...baseProps({ name: 'Tool 1', yamlJsonObject, setYamlJsonObject, isEntrypoint: false })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Node actions' }));
    fireEvent.click(await screen.findByText('Make entrypoint'));
    expect(setYamlJsonObject).toHaveBeenCalledWith({ nodes: [{ id: 'Tool 1' }], entry_point: 'Tool 1' });
  });

  it('shows a Deprecated badge for a deprecated node type', () => {
    renderWithTheme(<NodeCardHeader {...baseProps({ type: 'tool' })} />);
    expect(screen.getByText('Deprecated!')).toBeInTheDocument();
  });

  it('shows no Deprecated badge for a non-deprecated node type', () => {
    renderWithTheme(<NodeCardHeader {...baseProps({ type: 'llm' })} />);
    expect(screen.queryByText('Deprecated!')).not.toBeInTheDocument();
  });

  it('enters rename mode on double-click of the name, and commits the rename on blur', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();
    const setFlowEdges = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'Tool 1' }] };
    renderWithTheme(
      <NodeCardHeader
        {...baseProps({
          name: 'Tool 1',
          type: 'llm',
          yamlJsonObject,
          setYamlJsonObject,
          setFlowNodes,
          setFlowEdges,
        })}
      />,
    );

    fireEvent.doubleClick(screen.getByText('Tool 1'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Tool 2' } });
    fireEvent.blur(input);

    expect(setYamlJsonObject).toHaveBeenCalledWith(expect.objectContaining({ nodes: [{ id: 'Tool 2' }] }));
    expect(setFlowNodes).toHaveBeenCalled();
    expect(setFlowEdges).toHaveBeenCalled();
  });

  it('rewrites EVERY flow node through the rename pass, not just the one whose id matches -- a sibling Decision node referencing the renamed node by name must be rewritten too', () => {
    const setFlowNodes = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [
        { id: 'Tool 1' },
        { id: 'Router 1', type: 'decision', nodes: ['Tool 1', 'End'], default_output: 'Tool 1' },
      ],
    };
    renderWithTheme(
      <NodeCardHeader {...baseProps({ name: 'Tool 1', type: 'llm', yamlJsonObject, setFlowNodes })} />,
    );

    fireEvent.doubleClick(screen.getByText('Tool 1'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Tool 1 Renamed' } });
    fireEvent.blur(input);

    expect(setFlowNodes).toHaveBeenCalledTimes(1);
    // Inspect the REAL updater function's behaviour against a two-node fixture,
    // rather than merely asserting `setFlowNodes` was called: the bug this
    // guards was that only the node whose `id === name` ever ran through the
    // rename pass at all, silently dropping every other node's reference
    // rewrite (a Decision node's own `data.nodes`/`data.default_output`).
    const updater = setFlowNodes.mock.calls[0]?.[0] as (prev: FlowNode[]) => FlowNode[];
    const prevFlowNodes: FlowNode[] = [
      { id: 'Tool 1', position: { x: 0, y: 0 }, data: { label: 'Tool 1' } },
      {
        id: 'Router 1',
        position: { x: 0, y: 0 },
        data: { label: 'Router 1', type: 'decision', nodes: ['Tool 1', 'End'], default_output: 'Tool 1' },
      },
    ];

    const nextFlowNodes = updater(prevFlowNodes);

    expect(nextFlowNodes[0]).toMatchObject({ id: 'Tool 1 Renamed', data: { label: 'Tool 1 Renamed' } });
    expect(nextFlowNodes[1]).toMatchObject({
      id: 'Router 1',
      data: { nodes: ['Tool 1 Renamed', 'End'], default_output: 'Tool 1 Renamed' },
    });
  });

  it('does not enter rename mode by double-click for a Condition node', () => {
    renderWithTheme(<NodeCardHeader {...baseProps({ type: 'condition' })} />);
    fireEvent.doubleClick(screen.getByText('Tool 1'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('calls onDuplicateName and reverts the input instead of renaming on a duplicate node name', () => {
    const onDuplicateName = vi.fn();
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'Tool 1' }, { id: 'Tool 2' }] };
    renderWithTheme(
      <NodeCardHeader
        {...baseProps({ name: 'Tool 1', type: 'llm', yamlJsonObject, setYamlJsonObject, onDuplicateName })}
      />,
    );

    fireEvent.doubleClick(screen.getByText('Tool 1'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Tool 2' } });
    fireEvent.blur(input);

    expect(onDuplicateName).toHaveBeenCalledWith(
      'The name has been used by other nodes, please input a new name!',
    );
    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('calls onDuplicateName with the toolkit-name message when the new name matches a toolName', () => {
    const onDuplicateName = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'Tool 1' }] };
    renderWithTheme(
      <NodeCardHeader
        {...baseProps({
          name: 'Tool 1',
          type: 'llm',
          yamlJsonObject,
          toolNames: ['github'],
          onDuplicateName,
        })}
      />,
    );

    fireEvent.doubleClick(screen.getByText('Tool 1'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'github' } });
    fireEvent.blur(input);

    expect(onDuplicateName).toHaveBeenCalledWith(
      'The name conflicts with an existing toolkit name "github", please input a new name!',
    );
  });

  it('does nothing on blur when the name is unchanged', () => {
    const setYamlJsonObject = vi.fn();
    renderWithTheme(<NodeCardHeader {...baseProps({ name: 'Tool 1', type: 'llm', setYamlJsonObject })} />);

    fireEvent.doubleClick(screen.getByText('Tool 1'));
    fireEvent.blur(screen.getByRole('textbox'));

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(screen.getByText('Tool 1')).toBeInTheDocument();
  });
});
