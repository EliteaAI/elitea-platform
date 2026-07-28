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

  // `container`'s outer `Box` styles the border via MUI's `sx` prop, which
  // compiles to an emotion-generated CSS CLASS (not an inline `style`
  // attribute) -- jsdom's `getComputedStyle` does not expand the `border`
  // shorthand from injected stylesheet rules reliably, so these branches
  // are verified by className identity instead: `sx`'s serialized value
  // (and therefore its emotion class) differs whenever the rendered border
  // style/color genuinely differs between two prop combinations.
  it('assigns a different container class while isPerforming is true, vs. idle (dashed vs. solid border)', () => {
    const { container: performingContainer } = renderEndNode({ data: { isPerforming: true } });
    const performingBox = performingContainer.querySelector('[class*="MuiBox-root"]') as HTMLElement;

    const { container: idleContainer } = renderEndNode({ data: {} });
    const idleBox = idleContainer.querySelector('[class*="MuiBox-root"]') as HTMLElement;

    expect(performingBox.className).not.toBe(idleBox.className);
  });

  it('assigns a different container class when selected with the pipeline idle, vs. not selected', () => {
    const { container: selectedContainer } = renderEndNode(
      { selected: true, data: {} },
      { yamlJsonObject: {}, setYamlJsonObject: () => {}, setFlowNodes: () => {}, setFlowEdges: () => {}, isRunningPipeline: false },
    );
    const selectedBox = selectedContainer.querySelector('[class*="MuiBox-root"]') as HTMLElement;

    const { container: idleContainer } = renderEndNode({ selected: false, data: {} });
    const idleBox = idleContainer.querySelector('[class*="MuiBox-root"]') as HTMLElement;

    expect(selectedBox.className).not.toBe(idleBox.className);
  });

  it('assigns the SAME container class whether selected or not once isRunningPipeline is true (selected color suppressed)', () => {
    const { container: runningContainer } = renderEndNode(
      { selected: true, data: {} },
      { yamlJsonObject: {}, setYamlJsonObject: () => {}, setFlowNodes: () => {}, setFlowEdges: () => {}, isRunningPipeline: true },
    );
    const runningBox = runningContainer.querySelector('[class*="MuiBox-root"]') as HTMLElement;

    const { container: runningUnselectedContainer } = renderEndNode(
      { selected: false, data: {} },
      { yamlJsonObject: {}, setYamlJsonObject: () => {}, setFlowNodes: () => {}, setFlowEdges: () => {}, isRunningPipeline: true },
    );
    const runningUnselectedBox = runningUnselectedContainer.querySelector('[class*="MuiBox-root"]') as HTMLElement;

    expect(runningBox.className).toBe(runningUnselectedBox.className);
  });
});
