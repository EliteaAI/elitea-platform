import { beforeEach, describe, expect, it } from 'vitest';

import type { FlowNode } from '../lib/flow-editor/reactFlowTypes';
import { createPipelineEditorStore, usePipelineEditorStore } from './pipelineEditorStore';

beforeEach(() => {
  usePipelineEditorStore.getState().resetPipelineEditor();
  usePipelineEditorStore.getState().clearStateValidationErrors();
});

describe('createPipelineEditorStore', () => {
  it('starts with empty nodes/edges/errors', () => {
    const store = createPipelineEditorStore();
    expect(store.getState()).toMatchObject({ nodes: [], edges: [], stateValidationErrors: {} });
  });

  it('setNodes/setEdges replace the arrays', () => {
    const store = createPipelineEditorStore();
    const node: FlowNode = { id: 'a', type: 'agent', position: { x: 0, y: 0 }, data: {} };
    store.getState().setNodes([node]);
    expect(store.getState().nodes).toEqual([node]);
  });

  it('resetPipelineEditor clears nodes and edges', () => {
    const store = createPipelineEditorStore();
    store.getState().setNodes([{ id: 'a', type: 'agent', position: { x: 0, y: 0 }, data: {} }]);
    store.getState().resetPipelineEditor();
    expect(store.getState().nodes).toEqual([]);
    expect(store.getState().edges).toEqual([]);
  });

  it('setStateValidationError sets an error, then clearing it (error: null) removes the key', () => {
    const store = createPipelineEditorStore();
    store.getState().setStateValidationError('count', 'Invalid number format');
    expect(store.getState().stateValidationErrors).toEqual({ count: 'Invalid number format' });
    store.getState().setStateValidationError('count', null);
    expect(store.getState().stateValidationErrors).toEqual({});
  });

  it('clearStateValidationErrors wipes every entry at once', () => {
    const store = createPipelineEditorStore();
    store.getState().setStateValidationError('a', 'bad');
    store.getState().setStateValidationError('b', 'also bad');
    store.getState().clearStateValidationErrors();
    expect(store.getState().stateValidationErrors).toEqual({});
  });
});

describe('usePipelineEditorStore (lazy singleton)', () => {
  it('getState/setState operate on the same underlying instance the hook selector reads', () => {
    usePipelineEditorStore.setState({ stateValidationErrors: { x: 'err' } });
    expect(usePipelineEditorStore.getState().stateValidationErrors).toEqual({ x: 'err' });
  });
});
