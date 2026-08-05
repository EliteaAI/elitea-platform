import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStateStore } from './editorState';

function reset(): void {
  useEditorStateStore.setState({
    isEditingAgent: false,
    isEditingPipeline: false,
    isEditingToolkit: false,
    isEditingCanvas: false,
    isEditingArtifact: false,
    isAnyEditorOpen: false,
  });
}

describe('useEditorStateStore', () => {
  beforeEach(() => {
    reset();
  });

  it('defaults every flag to false', () => {
    const state = useEditorStateStore.getState();
    expect(state.isEditingAgent).toBe(false);
    expect(state.isEditingPipeline).toBe(false);
    expect(state.isEditingToolkit).toBe(false);
    expect(state.isEditingCanvas).toBe(false);
    expect(state.isEditingArtifact).toBe(false);
    expect(state.isAnyEditorOpen).toBe(false);
  });

  it.each([
    ['setEditingAgent', 'isEditingAgent'],
    ['setEditingPipeline', 'isEditingPipeline'],
    ['setEditingToolkit', 'isEditingToolkit'],
    ['setEditingCanvas', 'isEditingCanvas'],
    ['setEditingArtifact', 'isEditingArtifact'],
  ] as const)('%s sets only %s and derives isAnyEditorOpen', (setterName, flagName) => {
    const state = useEditorStateStore.getState();
    const setter = state[setterName];

    setter(true);

    const next = useEditorStateStore.getState();
    expect(next[flagName]).toBe(true);
    expect(next.isAnyEditorOpen).toBe(true);

    const others = (
      ['isEditingAgent', 'isEditingPipeline', 'isEditingToolkit', 'isEditingCanvas', 'isEditingArtifact'] as const
    ).filter((key) => key !== flagName);
    for (const other of others) {
      expect(next[other]).toBe(false);
    }

    setter(false);
    expect(useEditorStateStore.getState()[flagName]).toBe(false);
    expect(useEditorStateStore.getState().isAnyEditorOpen).toBe(false);
  });

  it('keeps isAnyEditorOpen true while any flag remains set', () => {
    const state = useEditorStateStore.getState();
    state.setEditingAgent(true);
    state.setEditingCanvas(true);

    useEditorStateStore.getState().setEditingAgent(false);

    expect(useEditorStateStore.getState().isEditingCanvas).toBe(true);
    expect(useEditorStateStore.getState().isAnyEditorOpen).toBe(true);

    useEditorStateStore.getState().setEditingCanvas(false);
    expect(useEditorStateStore.getState().isAnyEditorOpen).toBe(false);
  });
});
