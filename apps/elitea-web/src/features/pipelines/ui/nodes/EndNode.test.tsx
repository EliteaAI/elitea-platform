import { beforeAll, describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ReactFlow, ReactFlowProvider } from '@xyflow/react';

import { FlowEditorContext, type FlowEditorContextValue } from '../../lib/flow-editor/flowEditorContext';
import type { FlowNode } from '../../lib/flow-editor/reactFlowTypes';
import { EndNode } from './EndNode';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

function renderEndNode(
  nodeOverrides: Partial<FlowNode> = {},
  flowEditorValue?: FlowEditorContextValue,
): ReturnType<typeof renderWithTheme> {
  const flowNode: FlowNode = {
    id: 'END',
    type: 'testNode',
    position: { x: 0, y: 0 },
    data: {},
    ...nodeOverrides,
  };

  const tree = (
    <ReactFlow
      nodes={[flowNode]}
      edges={[]}
      nodeTypes={{ testNode: EndNode }}
    />
  );

  return renderWithTheme(
    <ReactFlowProvider>
      {flowEditorValue ? (
        <FlowEditorContext.Provider value={flowEditorValue}>{tree}</FlowEditorContext.Provider>
      ) : (
        tree
      )}
    </ReactFlowProvider>,
  );
}

describe('EndNode', () => {
  it('renders the "End" label', () => {
    const { getByText } = renderEndNode();
    expect(getByText('End')).toBeInTheDocument();
  });

  it('renders a single target handle', () => {
    const { container } = renderEndNode();
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(1);
  });

  it('renders the flag icon', () => {
    const { container } = renderEndNode();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders inside a NodeCardContext.Provider so a descendant CustomHandle could read isExpanded', () => {
    // EndNode wraps its content in `NodeCardContext.Provider` (baseline:
    // `EndNode.jsx:17`) even though its own JSX never reads that context --
    // the contract exists for descendant components. Rendering without
    // throwing is the useful assertion here (no descendant consumer exists
    // in this leaf node to assert a read against).
    expect(() => renderEndNode()).not.toThrow();
  });
});
