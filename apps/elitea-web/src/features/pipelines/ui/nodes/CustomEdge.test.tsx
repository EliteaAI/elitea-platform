import { beforeAll, describe, expect, it } from 'vitest';
import type { RenderResult } from '@testing-library/react';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { Position, ReactFlow, ReactFlowProvider, type EdgeProps } from '@xyflow/react';

import type { FlowEdge } from '../../lib/flow-editor/reactFlowTypes';
import { CustomEdge } from './CustomEdge';

// jsdom (this project's `node` test environment) has no `ResizeObserver` --
// `<ReactFlow>` (mounted here only so `EdgeLabelRenderer`'s portal target
// exists, see `renderEdge` below) measures its viewport with one on mount.
// Not part of this app's shared `src/test/setup.ts` (verified: no
// `ResizeObserver` polyfill there), so a minimal no-op stub is scoped to
// this file only.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

function makeProps(overrides: Partial<EdgeProps<FlowEdge>> = {}): EdgeProps<FlowEdge> {
  return {
    id: 'edge-1',
    source: 'A',
    target: 'B',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    selectable: true,
    deletable: true,
    ...overrides,
  };
}

function renderEdge(props: EdgeProps<FlowEdge>): RenderResult {
  return renderWithTheme(
    <ReactFlowProvider>
      {/* `EdgeLabelRenderer` portals into a container div that only
          `<ReactFlow>` itself creates -- a bare `<ReactFlowProvider>` has
          nowhere for the portal to render into. `CustomEdge` here is
          rendered manually (not via `edgeTypes`) purely so its `<path>`s
          land inside a plain `<svg>` this test can query directly by id,
          while still sharing the same provider (and therefore the same
          portal container) as the `<ReactFlow>` shell alongside it. */}
      <ReactFlow
        nodes={[]}
        edges={[]}
      />
      <svg>
        <CustomEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

/** `BaseEdge` renders both a visible `<path id="...">` and an invisible wider hit-target path -- select by the exact id to avoid picking the wrong one. */
function getEdgePath(container: HTMLElement, id: string): SVGPathElement {
  const path = container.querySelector(`path#${CSS.escape(id)}`);
  if (!path) {
    throw new Error(`no <path id="${id}"> found`);
  }
  return path as SVGPathElement;
}

describe('CustomEdge', () => {
  it('renders a background path and a main path, both following the same bezier geometry', () => {
    const { container } = renderEdge(makeProps());
    const bg = getEdgePath(container, 'edge-1-bg');
    const main = getEdgePath(container, 'edge-1');
    expect(bg.getAttribute('d')).toBe(main.getAttribute('d'));
  });

  it('gives the background path a wider stroke than the main path', () => {
    const { container } = renderEdge(makeProps());
    const bgWidth = Number(getEdgePath(container, 'edge-1-bg').style.strokeWidth);
    const mainWidth = Number(getEdgePath(container, 'edge-1').style.strokeWidth);
    expect(bgWidth).toBeGreaterThan(mainWidth);
  });

  it('thickens the main stroke when selected', () => {
    const { container: unselected, unmount } = renderEdge(makeProps({ selected: false }));
    const unselectedWidth = Number(getEdgePath(unselected, 'edge-1').style.strokeWidth);
    unmount();

    const { container: selectedContainer } = renderEdge(makeProps({ selected: true }));
    const selectedWidth = Number(getEdgePath(selectedContainer, 'edge-1').style.strokeWidth);

    expect(selectedWidth).toBeGreaterThan(unselectedWidth);
  });

  it('applies no drop-shadow filter when not selected', () => {
    const { container } = renderEdge(makeProps({ selected: false }));
    expect(getEdgePath(container, 'edge-1').style.filter).toBe('none');
  });

  it('applies a drop-shadow filter when selected', () => {
    const { container } = renderEdge(makeProps({ selected: true }));
    expect(getEdgePath(container, 'edge-1').style.filter).toContain('drop-shadow');
  });

  it('renders no label text when data.label is absent', () => {
    const { queryByText } = renderEdge(makeProps());
    expect(queryByText('Interrupt')).not.toBeInTheDocument();
  });

  it('renders the label text when data.label is present', () => {
    const { getByText } = renderEdge(makeProps({ data: { label: 'Interrupt' } }));
    expect(getByText('Interrupt')).toBeInTheDocument();
  });

  // NOTE (coverage gap, disclosed): the `useEffect`'s `svgAncestor` truthy
  // branch (`document.querySelector('[data-id="..."]')?.closest('svg')`,
  // then setting its `style.zIndex`) is not exercised by any test in this
  // file. React Flow only stamps `data-id` on the internal edge-wrapper
  // `<g>` it renders for a REGISTERED edge (`edgeTypes`) -- attempted here
  // via a real `<ReactFlow nodes=... edges=... edgeTypes={{custom:
  // CustomEdge}}>` tree, but React Flow's `.react-flow__edges` container
  // stayed permanently empty even with explicit `measured: {width,height}`
  // on both nodes (no `ResizeObserver` real implementation in this jsdom
  // env to flip `nodesInitialized`, and edges do not render before that).
  // The other tests in this file mount `CustomEdge` directly (see
  // `renderEdge`'s own doc comment) specifically to sidestep that same
  // limitation for path/label assertions; this one effect body has no such
  // workaround available.
});
