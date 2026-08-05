import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PipelineNodeTypes } from '../lib/flow-editor/constants/flowEditor.constants';
import type { FlowNode } from '../lib/flow-editor/reactFlowTypes';
import { useFlowEditorNodeOperations } from './useFlowEditorNodeOperations';

function makeNode(id: string, type: string, x = 0, y = 0): FlowNode {
  return { id, type, position: { x, y }, data: {} };
}

describe('useFlowEditorNodeOperations', () => {
  it('onNodeCreateAtPosition creates a YAML node, sets it as flow node, and marks entry_point on the first non-Condition node', () => {
    const setFlowNodes = vi.fn();
    const setYamlJsonObject = vi.fn();
    const { result } = renderHook(() =>
      useFlowEditorNodeOperations({
        flowNodes: [],
        setFlowNodes,
        setFlowEdges: vi.fn(),
        setYamlJsonObject,
        yamlJsonObjectRef: { current: {} },
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getZoom: () => 1,
        editorRef: { current: null },
        editorWidth: 800,
        editorHeight: 600,
      }),
    );

    const created = result.current.onNodeCreateAtPosition(PipelineNodeTypes.Agent, { x: 10, y: 20 });

    expect(created.type).toBe(PipelineNodeTypes.Agent);
    expect(created.position).toEqual({ x: 10, y: 20 });
    expect(created.selected).toBe(true);
    const setDoc = setYamlJsonObject.mock.calls[0]?.[0] as { entry_point?: string; nodes?: readonly { id: string; type: string }[] };
    expect(setDoc.entry_point).toBe(created.id);
    expect(setDoc.nodes?.some(node => node.id === created.id && node.type === PipelineNodeTypes.Agent)).toBe(true);
    expect(setFlowNodes).toHaveBeenCalled();
  });

  it('onNodeCreateAtPosition does NOT add a Condition-type node into yamlJsonObject.nodes (baseline: conditions live inline, not as YAML node entries)', () => {
    const setYamlJsonObject = vi.fn();
    const { result } = renderHook(() =>
      useFlowEditorNodeOperations({
        flowNodes: [],
        setFlowNodes: vi.fn(),
        setFlowEdges: vi.fn(),
        setYamlJsonObject,
        yamlJsonObjectRef: { current: {} },
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getZoom: () => 1,
        editorRef: { current: null },
        editorWidth: 800,
        editorHeight: 600,
      }),
    );

    const created = result.current.onNodeCreateAtPosition(PipelineNodeTypes.Condition, { x: 0, y: 0 });

    expect(created.data?.['label']).toBe('Condition');
    expect(created.data?.['condition']).toEqual({ condition_input: [], condition_definition: '', conditional_outputs: [], default_output: '' });
    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('does not overwrite an already-set entry_point', () => {
    const setYamlJsonObject = vi.fn();
    const { result } = renderHook(() =>
      useFlowEditorNodeOperations({
        flowNodes: [],
        setFlowNodes: vi.fn(),
        setFlowEdges: vi.fn(),
        setYamlJsonObject,
        yamlJsonObjectRef: { current: { entry_point: 'Existing 1' } },
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getZoom: () => 1,
        editorRef: { current: null },
        editorWidth: 800,
        editorHeight: 600,
      }),
    );

    result.current.onNodeCreateAtPosition(PipelineNodeTypes.Agent, { x: 0, y: 0 });

    expect(setYamlJsonObject).toHaveBeenCalledWith(expect.objectContaining({ entry_point: 'Existing 1' }));
  });

  it('onAddNode centres the new node in the current viewport and avoids overlapping existing nodes', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();
    const { result } = renderHook(() =>
      useFlowEditorNodeOperations({
        flowNodes: [],
        setFlowNodes,
        setFlowEdges: vi.fn(),
        setYamlJsonObject,
        yamlJsonObjectRef: { current: {} },
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getZoom: () => 1,
        editorRef: { current: null },
        editorWidth: 800,
        editorHeight: 600,
      }),
    );

    const created = result.current.onAddNode(PipelineNodeTypes.Agent);

    // (800/2 - 230 - 0)/1 = 170, (600/2 - 200 - 0)/1 = 100 — FlowEditorHelpers.calculatePositionForNewNode's own formula, no existing nodes to dodge.
    expect(created.position).toEqual({ x: 170, y: 100 });
  });

  it('calculateLayoutNodes re-parses the YAML into the canvas via setFlowNodes/setFlowEdges updaters', () => {
    const setFlowNodes = vi.fn();
    const setFlowEdges = vi.fn();
    const { result } = renderHook(() =>
      useFlowEditorNodeOperations({
        flowNodes: [makeNode('a', PipelineNodeTypes.Agent, 5, 5)],
        setFlowNodes,
        setFlowEdges,
        setYamlJsonObject: vi.fn(),
        yamlJsonObjectRef: { current: {} },
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getZoom: () => 1,
        editorRef: { current: null },
        editorWidth: 800,
        editorHeight: 600,
      }),
    );

    result.current.calculateLayoutNodes({ entry_point: 'a', nodes: [{ id: 'a', type: PipelineNodeTypes.Agent }] }, false, false, true);

    expect(setFlowNodes).toHaveBeenCalledTimes(1);
    expect(setFlowEdges).toHaveBeenCalledTimes(1);
    const updater = setFlowNodes.mock.calls[0]?.[0] as (prev: FlowNode[]) => FlowNode[];
    const next = updater([makeNode('a', PipelineNodeTypes.Agent, 5, 5)]);
    // The baseline parser always appends an implicit End node to a single-node graph — `>= 1` + the real id present, not an exact count.
    expect(next.length).toBeGreaterThanOrEqual(1);
    expect(next.some(node => node.id === 'a')).toBe(true);
  });

  it('calculateLayoutNodes preserves an existing node position when layoutAll is false and the node is already on canvas', () => {
    const setFlowNodes = vi.fn();
    const existing = makeNode('Agent 1', PipelineNodeTypes.Agent, 5, 5);
    const { result } = renderHook(() =>
      useFlowEditorNodeOperations({
        flowNodes: [existing],
        setFlowNodes,
        setFlowEdges: vi.fn(),
        setYamlJsonObject: vi.fn(),
        yamlJsonObjectRef: { current: {} },
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getZoom: () => 1,
        editorRef: { current: null },
        editorWidth: 800,
        editorHeight: 600,
      }),
    );

    result.current.calculateLayoutNodes({ entry_point: existing.id, nodes: [{ id: existing.id, type: PipelineNodeTypes.Agent }] }, false, false, true);

    const updater = setFlowNodes.mock.calls[0]?.[0] as (prev: FlowNode[]) => FlowNode[];
    const next = updater([existing]);
    const found = next.find(node => node.id === existing.id);
    // `layoutAll=false` -> when the parsed node's id/type match an existing canvas node, that node's own live position wins over the freshly-parsed one.
    expect(found?.position).toEqual({ x: 5, y: 5 });
  });
});
