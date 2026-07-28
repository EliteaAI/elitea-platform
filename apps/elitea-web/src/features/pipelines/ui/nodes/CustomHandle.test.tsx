import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, type RenderResult } from '@testing-library/react';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ReactFlow, ReactFlowProvider } from '@xyflow/react';

import { NodeCardContext } from '../../lib/flow-editor/flowEditorContext';
import { CustomHandle, type CustomHandleProps } from './CustomHandle';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

// Every test in this file renders a fresh `<ReactFlow>` tree with the same
// node id ('node-1'); without an explicit unmount between tests, each new
// `renderWithTheme` call's queries are bound to `document.body` (RTL's
// default `baseElement`), which still contains the PREVIOUS test's DOM --
// proven empirically (a "no label when collapsed" assertion failed by
// finding the *previous* test's "Input" label still in the document).
afterEach(() => {
  cleanup();
});

/**
 * `CustomHandle` calls `useNodeId()`/`useEdges()`/`useReactFlow()`, all of
 * which require an ancestor `<ReactFlow>` (same reason `CustomEdge.test.tsx`
 * mounts one) -- rendered here via `nodeTypes` so a real node id is in
 * context. `isExpanded` is supplied through `NodeCardContext.Provider`
 * (baseline: `NodeCard.jsx`'s own `<NodeCardContext.Provider value={{
 * isExpanded }}>`), matching how the real `NodeCard` wires it.
 */
const NO_PROVIDER = Symbol('no NodeCardContext.Provider');

function renderHandle(
  props: CustomHandleProps,
  isExpanded: boolean | typeof NO_PROVIDER = true,
): RenderResult {
  function TestNode(): ReactNode {
    return isExpanded === NO_PROVIDER ? (
      <CustomHandle {...props} />
    ) : (
      <NodeCardContext.Provider value={{ isExpanded }}>
        <CustomHandle {...props} />
      </NodeCardContext.Provider>
    );
  }

  return renderWithTheme(
    <ReactFlowProvider>
      <ReactFlow
        nodes={[{ id: 'node-1', type: 'testNode', position: { x: 0, y: 0 }, data: {} }]}
        edges={[]}
        nodeTypes={{ testNode: TestNode }}
      />
    </ReactFlowProvider>,
  );
}

describe('CustomHandle', () => {
  it('renders a target handle with the default "Input" label when expanded', () => {
    const { getByText } = renderHandle({ type: 'target', id: 'target' });
    expect(getByText('Input')).toBeInTheDocument();
  });

  it('renders a source handle with the default "Output" label when expanded', () => {
    const { getByText } = renderHandle({ type: 'source', id: 'source' });
    expect(getByText('Output')).toBeInTheDocument();
  });

  it('honours an explicit label over the type-derived default', () => {
    const { getByText, queryByText } = renderHandle({ type: 'target', id: 'target', label: 'Custom label' });
    expect(getByText('Custom label')).toBeInTheDocument();
    expect(queryByText('Input')).not.toBeInTheDocument();
  });

  it('renders no label text when collapsed', () => {
    const { queryByText } = renderHandle({ type: 'target', id: 'target' }, false);
    expect(queryByText('Input')).not.toBeInTheDocument();
  });

  it('renders no label text outside a NodeCardContext.Provider', () => {
    const { queryByText } = renderHandle({ type: 'target', id: 'target' }, NO_PROVIDER);
    expect(queryByText('Input')).not.toBeInTheDocument();
  });

  it('renders the plus-icon affordance only for a source handle, not a target handle', () => {
    const { container: sourceContainer } = renderHandle({ type: 'source', id: 'source' });
    const { container: targetContainer } = renderHandle({ type: 'target', id: 'target' });

    expect(sourceContainer.querySelectorAll('svg').length).toBeGreaterThan(
      targetContainer.querySelectorAll('svg').length,
    );
  });
});
