import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type UseAgentEditorUrlSyncParams, useAgentEditorUrlSync } from './useAgentEditorUrlSync';

function baseParams(overrides: Partial<UseAgentEditorUrlSyncParams> = {}): UseAgentEditorUrlSyncParams {
  return {
    editingAgent: undefined,
    editingPipeline: undefined,
    onShowAgentEditor: vi.fn(),
    onShowPipelineEditor: vi.fn(),
    activeConversation: undefined,
    isEditingAgent: false,
    isEditingPipeline: false,
    isAnyEditorOpen: false,
    editedParticipantId: undefined,
    setEditedParticipantId: vi.fn(),
    clearEditedParticipantId: vi.fn(),
    ...overrides,
  };
}

describe('useAgentEditorUrlSync', () => {
  it('sets the URL param when an agent editor opens with an editing agent', () => {
    const setEditedParticipantId = vi.fn();
    renderHook(() =>
      useAgentEditorUrlSync(
        baseParams({
          isEditingAgent: true,
          editingAgent: { id: 42 },
          setEditedParticipantId,
        }),
      ),
    );

    expect(setEditedParticipantId).toHaveBeenCalledWith(42);
  });

  it('prefers id over entity_meta.id when both are present (matches the baseline: `editingAgent.id || editingAgent.entity_meta?.id`)', () => {
    const setEditedParticipantId = vi.fn();
    renderHook(() =>
      useAgentEditorUrlSync(
        baseParams({
          isEditingAgent: true,
          editingAgent: { id: 1, entity_meta: { id: 99 } },
          setEditedParticipantId,
        }),
      ),
    );

    expect(setEditedParticipantId).toHaveBeenCalledWith(1);
  });

  it('falls back to entity_meta.id when id is absent', () => {
    const setEditedParticipantId = vi.fn();
    renderHook(() =>
      useAgentEditorUrlSync(
        baseParams({
          isEditingAgent: true,
          editingAgent: { entity_meta: { id: 99 } },
          setEditedParticipantId,
        }),
      ),
    );

    expect(setEditedParticipantId).toHaveBeenCalledWith(99);
  });

  it('does not re-set the URL param when it already matches', () => {
    const setEditedParticipantId = vi.fn();
    renderHook(() =>
      useAgentEditorUrlSync(
        baseParams({
          isEditingAgent: true,
          editingAgent: { id: 42 },
          editedParticipantId: '42',
          setEditedParticipantId,
        }),
      ),
    );

    expect(setEditedParticipantId).not.toHaveBeenCalled();
  });

  it('clears the URL param once an editor the user explicitly closed leaves no editing entity', () => {
    const clearEditedParticipantId = vi.fn();
    const { result, rerender } = renderHook(
      (props: UseAgentEditorUrlSyncParams) => useAgentEditorUrlSync(props),
      {
        initialProps: baseParams({
          isEditingAgent: true,
          editingAgent: { id: 42 },
          editedParticipantId: '42',
          clearEditedParticipantId,
        }),
      },
    );

    result.current.markAgentEditorClosed();
    rerender(
      baseParams({
        isEditingAgent: false,
        editingAgent: undefined,
        editedParticipantId: '42',
        clearEditedParticipantId,
      }),
    );

    expect(clearEditedParticipantId).toHaveBeenCalled();
  });

  it('preserves the URL param during the transient restoration window (isEditingAgent true, editingAgent not set yet)', () => {
    const clearEditedParticipantId = vi.fn();
    renderHook(() =>
      useAgentEditorUrlSync(
        baseParams({
          isEditingAgent: true,
          editingAgent: undefined,
          editedParticipantId: '42',
          clearEditedParticipantId,
        }),
      ),
    );

    expect(clearEditedParticipantId).not.toHaveBeenCalled();
  });

  it('restores the agent editor from the URL param once the conversation loads', () => {
    const onShowAgentEditor = vi.fn();
    const onShowPipelineEditor = vi.fn();
    const participant = { id: 'p1', entity_meta: { id: 42 }, entity_name: 'application' };
    renderHook(() =>
      useAgentEditorUrlSync(
        baseParams({
          editedParticipantId: '42',
          activeConversation: { id: 'c1', participants: [participant] },
          onShowAgentEditor,
          onShowPipelineEditor,
        }),
      ),
    );

    expect(onShowAgentEditor).toHaveBeenCalledWith(participant);
    expect(onShowPipelineEditor).not.toHaveBeenCalled();
  });

  it('restores the pipeline editor when the matched participant is a pipeline', () => {
    const onShowAgentEditor = vi.fn();
    const onShowPipelineEditor = vi.fn();
    const participant = { id: 'p1', entity_meta: { id: 42 }, entity_settings: { agent_type: 'pipeline' } };
    renderHook(() =>
      useAgentEditorUrlSync(
        baseParams({
          editedParticipantId: '42',
          activeConversation: { id: 'c1', participants: [participant] },
          onShowAgentEditor,
          onShowPipelineEditor,
        }),
      ),
    );

    expect(onShowPipelineEditor).toHaveBeenCalledWith(participant);
    expect(onShowAgentEditor).not.toHaveBeenCalled();
  });

  it('does not restore anything while participants have not loaded yet', () => {
    const onShowAgentEditor = vi.fn();
    renderHook(() =>
      useAgentEditorUrlSync(
        baseParams({
          editedParticipantId: '42',
          activeConversation: { id: 'c1', participants: [] },
          onShowAgentEditor,
        }),
      ),
    );

    expect(onShowAgentEditor).not.toHaveBeenCalled();
  });

  it('does not restore an editor that a user just explicitly closed', () => {
    const onShowAgentEditor = vi.fn();
    const participant = { id: 'p1', entity_meta: { id: 42 } };
    // Mounts with no URL param yet (so nothing restores on mount), marks the
    // agent editor closed-by-user, THEN the URL param arrives matching a real
    // participant — the close flag must still suppress the restore.
    const { result, rerender } = renderHook(
      (props: UseAgentEditorUrlSyncParams) => useAgentEditorUrlSync(props),
      {
        initialProps: baseParams({
          editedParticipantId: undefined,
          activeConversation: { id: 'c1', participants: [participant] },
          onShowAgentEditor,
        }),
      },
    );

    result.current.markAgentEditorClosed();
    rerender(
      baseParams({
        editedParticipantId: '42',
        activeConversation: { id: 'c1', participants: [participant] },
        onShowAgentEditor,
      }),
    );

    expect(onShowAgentEditor).not.toHaveBeenCalled();
  });
});
