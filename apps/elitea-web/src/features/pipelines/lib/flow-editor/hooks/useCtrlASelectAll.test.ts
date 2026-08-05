import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowEdge, FlowNode, SetFlowEdges, SetFlowNodes } from '../reactFlowTypes';
import { useCtrlASelectAll } from './useCtrlASelectAll';

/**
 * `@xyflow/react`'s `useKeyPress` accumulates `event.key` across keydown
 * events into a `Set` and only matches once every key in a combination has
 * been seen — a real Ctrl+A keystroke fires two keydowns (the modifier,
 * then the letter with `ctrlKey: true`), so the test must dispatch both.
 */
function pressCtrlA(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }));
}

describe('useCtrlASelectAll', () => {
  it('selects every node and edge on Ctrl+A when the canvas is visible', () => {
    const node: FlowNode = { id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: {}, selected: false };
    const edge: FlowEdge = { id: 'e1', source: 'n1', target: 'n2', selected: false };
    const setFlowNodes = vi.fn<SetFlowNodes>(updater => (typeof updater === 'function' ? updater([node]) : updater));
    const setFlowEdges = vi.fn<SetFlowEdges>(updater => (typeof updater === 'function' ? updater([edge]) : updater));

    renderHook(() => useCtrlASelectAll({ display: 'flex', setFlowNodes, setFlowEdges }));

    act(() => {
      pressCtrlA();
    });

    expect(setFlowNodes).toHaveBeenCalledTimes(1);
    expect(setFlowEdges).toHaveBeenCalledTimes(1);
    expect(setFlowNodes.mock.results[0]?.value).toEqual([{ ...node, selected: true }]);
    expect(setFlowEdges.mock.results[0]?.value).toEqual([{ ...edge, selected: true }]);
  });

  it('does nothing when the canvas display is "none"', () => {
    const setFlowNodes = vi.fn();
    const setFlowEdges = vi.fn();

    renderHook(() => useCtrlASelectAll({ display: 'none', setFlowNodes, setFlowEdges }));

    act(() => {
      pressCtrlA();
    });

    expect(setFlowNodes).not.toHaveBeenCalled();
    expect(setFlowEdges).not.toHaveBeenCalled();
  });
});
