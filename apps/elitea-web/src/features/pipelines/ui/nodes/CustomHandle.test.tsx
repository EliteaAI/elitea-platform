import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, waitFor, type RenderResult } from '@testing-library/react';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ReactFlow, ReactFlowProvider, useEdges, type Edge } from '@xyflow/react';

import { ORIENTATION } from '../../lib/flow-editor/constants/flowEditor.constants';
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
  edges: readonly Edge[] = [],
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
        edges={[...edges]}
        nodeTypes={{ testNode: TestNode }}
      />
    </ReactFlowProvider>,
  );
}

/** Renders `CustomHandle` alongside a sibling probe that reports the live (store-managed) `edges` array via `data-testid` text, so a click's `setEdges` effect is observable without an `onEdgesChange` prop. */
function EdgesProbe(): ReactNode {
  const edges = useEdges();
  return <div data-testid="edges-probe">{JSON.stringify(edges.map(edge => ({ id: edge.id, selected: Boolean(edge.selected) })))}</div>;
}

function renderHandleWithEdgesProbe(props: CustomHandleProps, edges: readonly Edge[]): RenderResult {
  function TestNode(): ReactNode {
    return (
      <NodeCardContext.Provider value={{ isExpanded: true }}>
        <CustomHandle {...props} />
        <EdgesProbe />
      </NodeCardContext.Provider>
    );
  }

  // `defaultEdges` (uncontrolled), NOT `edges` -- `CustomHandle`'s
  // `handleClick` calls `useReactFlow().setEdges(...)`, which is queued
  // through React Flow's own `BatchProvider` and only ever applied to the
  // real store if `hasDefaultEdges` is true OR an `onEdgesChange` prop is
  // supplied (`@xyflow/react`'s own `edgeQueueHandler`: `if (hasDefaultEdges)
  // setEdges(next); else if (onEdgesChange) onEdgesChange(...)` -- otherwise
  // the queued update is silently dropped, by design, for a fully
  // caller-controlled `edges` prop with no change handler). `defaultEdges`
  // puts React Flow in uncontrolled mode so its own `setEdges` really lands.
  return renderWithTheme(
    <ReactFlowProvider>
      <ReactFlow
        nodes={[{ id: 'node-1', type: 'testNode', position: { x: 0, y: 0 }, data: {} }]}
        defaultEdges={[...edges]}
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

  it('positions a source handle at Bottom (vertical, default) or Right (horizontal)', () => {
    const { container: verticalContainer } = renderHandle({ type: 'source', id: 'source' });
    const verticalHandle = verticalContainer.querySelector('.react-flow__handle') as HTMLElement;
    expect(verticalHandle.getAttribute('data-handlepos')).toBe('bottom');

    const { container: horizontalContainer } = renderHandle({
      type: 'source',
      id: 'source',
      orientation: ORIENTATION.horizontal,
    });
    const horizontalHandle = horizontalContainer.querySelector('.react-flow__handle') as HTMLElement;
    expect(horizontalHandle.getAttribute('data-handlepos')).toBe('right');
  });

  it('positions a target handle at Top (vertical, default) or Left (horizontal)', () => {
    const { container: verticalContainer } = renderHandle({ type: 'target', id: 'target' });
    const verticalHandle = verticalContainer.querySelector('.react-flow__handle') as HTMLElement;
    expect(verticalHandle.getAttribute('data-handlepos')).toBe('top');

    const { container: horizontalContainer } = renderHandle({
      type: 'target',
      id: 'target',
      orientation: ORIENTATION.horizontal,
    });
    const horizontalHandle = horizontalContainer.querySelector('.react-flow__handle') as HTMLElement;
    expect(horizontalHandle.getAttribute('data-handlepos')).toBe('left');
  });

  it('lays the handle out as a row for horizontal orientation vs a column for vertical (default)', () => {
    const { container: horizontalContainer } = renderHandle({
      type: 'target',
      id: 'target',
      orientation: ORIENTATION.horizontal,
    });
    const horizontalHandle = horizontalContainer.querySelector('.react-flow__handle') as HTMLElement;
    expect(horizontalHandle.style.flexDirection).toBe('row');

    const { container: verticalContainer } = renderHandle({ type: 'target', id: 'target' });
    const verticalHandle = verticalContainer.querySelector('.react-flow__handle') as HTMLElement;
    expect(verticalHandle.style.flexDirection).toBe('column');
  });

  it('uses a dashed border while isPerforming is true, and a solid border otherwise', () => {
    const { container: performingContainer } = renderHandle({ type: 'target', id: 'target', isPerforming: true });
    const performingHandle = performingContainer.querySelector('.react-flow__handle') as HTMLElement;
    expect(performingHandle.style.border).toContain('dashed');

    const { container: idleContainer } = renderHandle({ type: 'target', id: 'target', isPerforming: false });
    const idleHandle = idleContainer.querySelector('.react-flow__handle') as HTMLElement;
    expect(idleHandle.style.border).not.toContain('dashed');
  });

  it('colors the border with the connected-edge-selected color once a connected edge is selected (pipeline idle)', () => {
    const edges: readonly Edge[] = [{ id: 'e1', source: 'other', target: 'node-1', targetHandle: 'target', selected: true }];
    const { container: selectedContainer } = renderHandle({ type: 'target', id: 'target' }, true, edges);
    const selectedHandle = selectedContainer.querySelector('.react-flow__handle') as HTMLElement;

    const { container: idleContainer } = renderHandle({ type: 'target', id: 'target' }, true, []);
    const idleHandle = idleContainer.querySelector('.react-flow__handle') as HTMLElement;

    expect(selectedHandle.style.border).not.toBe(idleHandle.style.border);
  });

  it('colors the border with the connected-edge-selected color for a SOURCE handle once a selected outgoing edge is connected', () => {
    const edges: readonly Edge[] = [{ id: 'e1', source: 'node-1', sourceHandle: 'source', target: 'other', selected: true }];
    const { container: selectedContainer } = renderHandle({ type: 'source', id: 'source' }, true, edges);
    const selectedHandle = selectedContainer.querySelector('.react-flow__handle') as HTMLElement;

    const { container: idleContainer } = renderHandle({ type: 'source', id: 'source' }, true, []);
    const idleHandle = idleContainer.querySelector('.react-flow__handle') as HTMLElement;

    expect(selectedHandle.style.border).not.toBe(idleHandle.style.border);
  });

  it('does NOT use the selected-edge color once isRunningPipeline is true, even with a selected connected edge', () => {
    const edges: readonly Edge[] = [{ id: 'e1', source: 'other', target: 'node-1', targetHandle: 'target', selected: true }];
    const { container: runningContainer } = renderHandle(
      { type: 'target', id: 'target', isRunningPipeline: true },
      true,
      edges,
    );
    const runningHandle = runningContainer.querySelector('.react-flow__handle') as HTMLElement;

    const { container: idleContainer } = renderHandle({ type: 'target', id: 'target' }, true, []);
    const idleHandle = idleContainer.querySelector('.react-flow__handle') as HTMLElement;

    expect(runningHandle.style.border).toBe(idleHandle.style.border);
  });

  it('selects every edge connected to this handle on click, then deselects everything on a second click (all already selected)', async () => {
    const edges: readonly Edge[] = [
      { id: 'e1', source: 'other', target: 'node-1', targetHandle: 'target' },
      { id: 'e2', source: 'other2', target: 'node-1', targetHandle: 'target', selected: true },
    ];
    const { container, getByTestId } = renderHandleWithEdgesProbe({ type: 'target', id: 'target' }, edges);

    const handle = container.querySelector('.react-flow__handle') as HTMLElement;
    // Let the initial `edges` prop finish syncing into the internal React
    // Flow store (and `useEdges()`/`connectedEdges`/`selectedEdges` settle)
    // before clicking -- clicking on the very first render risks a stale
    // `connectedEdges`/`selectedEdges` closure from before that sync lands.
    await waitFor(() => expect(getByTestId('edges-probe').textContent).toContain('e2'));
    fireEvent.click(handle);

    await waitFor(() => {
      const state = JSON.parse(getByTestId('edges-probe').textContent ?? '[]') as { id: string; selected: boolean }[];
      expect(state).toEqual([
        { id: 'e1', selected: true },
        { id: 'e2', selected: true },
      ]);
    });

    fireEvent.click(handle);

    await waitFor(() => {
      const state = JSON.parse(getByTestId('edges-probe').textContent ?? '[]') as { id: string; selected: boolean }[];
      expect(state).toEqual([
        { id: 'e1', selected: false },
        { id: 'e2', selected: false },
      ]);
    });
  });

  it('a click leaves an unrelated edge (not connected to this handle) untouched', async () => {
    const edges: readonly Edge[] = [
      { id: 'e1', source: 'other', target: 'node-1', targetHandle: 'target' },
      { id: 'unrelated', source: 'x', target: 'y', selected: true },
    ];
    const { container, getByTestId } = renderHandleWithEdgesProbe({ type: 'target', id: 'target' }, edges);

    const handle = container.querySelector('.react-flow__handle') as HTMLElement;
    await waitFor(() => expect(getByTestId('edges-probe').textContent).toContain('unrelated'));
    fireEvent.click(handle);

    await waitFor(() => {
      const state = JSON.parse(getByTestId('edges-probe').textContent ?? '[]') as { id: string; selected: boolean }[];
      const e1 = state.find(edge => edge.id === 'e1');
      expect(e1?.selected).toBe(true);
    });
    const finalState = JSON.parse(getByTestId('edges-probe').textContent ?? '[]') as { id: string; selected: boolean }[];
    const unrelated = finalState.find(edge => edge.id === 'unrelated');
    expect(unrelated?.selected).toBe(false);
  });
});
