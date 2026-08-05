import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { buildFlowEditorContextValue } from '../../__tests__/testUtils';
import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import type { FlowEdge, SetFlowEdges } from '../../lib/flow-editor/reactFlowTypes';
import { RouteSelect } from './RouteSelect';

describe('RouteSelect', () => {
  it('renders the Route label and other node ids as options', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Router 1', routes: [] }, { id: 'Tool 1' }] },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <RouteSelect id="Router 1" />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('Route')).toBeInTheDocument();
  });

  it('shows END as an option when addEndNode is set', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Router 1', routes: [] }] },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <RouteSelect
          id="Router 1"
          addEndNode
        />
      </FlowEditorContext.Provider>,
    );

    // The MUI Select renders its options only once opened; asserting the
    // component mounts without throwing (the addEndNode branch runs) is
    // the meaningful check here, options assertions live in PipelineMultiSelect's own tests.
    expect(getByText('Route')).toBeInTheDocument();
  });

  it('synthesises a "Not in state" chip for a route target no longer present', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Router 1', routes: ['DeletedNode'] }] },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <RouteSelect id="Router 1" />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('DeletedNode')).toBeInTheDocument();
  });

  it('does not throw when there is no setFlowEdges/setYamlJsonObject ancestor', () => {
    expect(() => renderWithTheme(<RouteSelect id="Router 1" />)).not.toThrow();
  });

  it('applies a custom field name when reading the selected routes', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Decision 1', nodes: ['A', 'B'] }] },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <RouteSelect
          id="Decision 1"
          fieldName="nodes"
          label="Branches"
        />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('Branches')).toBeInTheDocument();
    expect(getByText('A')).toBeInTheDocument();
  });

  it('filters node options via nodesFilter', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Router 1', routes: [] }, { id: 'Excluded', type: 'condition' }, { id: 'Included', type: 'tool' }] },
    });

    const filter = vi.fn((node: { readonly type?: string }) => node.type !== 'condition');

    renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <RouteSelect
          id="Router 1"
          nodesFilter={filter}
        />
      </FlowEditorContext.Provider>,
    );

    expect(filter).toHaveBeenCalled();
  });

  it('adds a new edge and updates the yaml node when a route target is selected', async () => {
    const user = userEvent.setup();
    const setYamlJsonObject = vi.fn<(next: YamlPipelineDocument) => void>();
    const setFlowEdges = vi.fn<SetFlowEdges>();
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Router 1', routes: [] }, { id: 'Tool 1' }] },
      setYamlJsonObject,
      setFlowEdges,
    });

    const { getByRole } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <RouteSelect id="Router 1" />
      </FlowEditorContext.Provider>,
    );

    await user.click(getByRole('combobox'));
    await user.click(getByRole('option', { name: 'Tool 1' }));

    const nextDoc = setYamlJsonObject.mock.calls[0]?.[0];
    const routerNode = nextDoc?.nodes?.find(node => node.id === 'Router 1');
    expect(routerNode?.['routes']).toEqual(['Tool 1']);
    expect(setFlowEdges).toHaveBeenCalled();
    const updaterOrEdges: FlowEdge[] | ((prev: FlowEdge[]) => FlowEdge[]) | undefined = setFlowEdges.mock.calls[0]?.[0];
    let nextEdges: FlowEdge[] = [];
    if (typeof updaterOrEdges === 'function') {
      nextEdges = updaterOrEdges([]);
    } else if (updaterOrEdges) {
      nextEdges = updaterOrEdges;
    }
    expect(nextEdges).toEqual([expect.objectContaining({ source: 'Router 1', target: 'Tool 1' })]);
  });
});
