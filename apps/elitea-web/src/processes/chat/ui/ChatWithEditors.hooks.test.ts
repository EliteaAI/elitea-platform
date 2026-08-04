import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Participant } from '@/entities/participant';
import { useEditorStateStore } from '@/shared/lib/editorState';
import { useNavBlockerStore } from '@/widgets/app-shell';

import { useChatWithEditors } from './ChatWithEditors.hooks';

function resetStores(): void {
  useEditorStateStore.setState({
    isEditingAgent: false,
    isEditingPipeline: false,
    isEditingToolkit: false,
    isEditingCanvas: false,
    isEditingArtifact: false,
    isAnyEditorOpen: false,
  });
  useNavBlockerStore.setState({ isBlockNav: false, isEditingAgent: false, isEditingPipeline: false, isEditingToolkit: false });
}

const AGENT: Participant = {
  id: '1',
  entityName: 'application',
  entityMeta: { id: '1', name: 'Agent One', projectId: 'proj-1' },
  entitySettings: { versionId: 'v1' },
};

const PIPELINE: Participant = {
  id: '2',
  entityName: 'pipeline',
  entityMeta: { id: '2', name: 'Pipeline Two' },
};

describe('useChatWithEditors', () => {
  beforeEach(() => {
    resetStores();
  });

  it('starts with every editor closed', () => {
    const { result } = renderHook(() => useChatWithEditors());
    expect(result.current.isEditingAgent).toBe(false);
    expect(result.current.isEditingPipeline).toBe(false);
    expect(result.current.isEditingToolkit).toBe(false);
    expect(result.current.mutex.openEditingAlert).toBe(false);
  });

  it('handleShowAgentEditor flips isEditingAgent (via editorState) and populates agentForEditor with the real participant fields', () => {
    const { result } = renderHook(() => useChatWithEditors());

    act(() => {
      result.current.handleShowAgentEditor(AGENT);
    });

    expect(result.current.isEditingAgent).toBe(true);
    expect(useEditorStateStore.getState().isEditingAgent).toBe(true);
    expect(useEditorStateStore.getState().isAnyEditorOpen).toBe(true);
    expect(result.current.agentForEditor).toEqual({
      id: '1',
      entity_meta: { id: '1', project_id: 'proj-1' },
      entity_settings: { version_id: 'v1' },
    });
  });

  it('editAgent.onCloseAgentEditor clears isEditingAgent back to false', () => {
    const { result } = renderHook(() => useChatWithEditors());

    act(() => {
      result.current.handleShowAgentEditor(AGENT);
    });
    expect(result.current.isEditingAgent).toBe(true);

    act(() => {
      result.current.editAgent.onCloseAgentEditor();
    });

    expect(result.current.isEditingAgent).toBe(false);
    expect(useEditorStateStore.getState().isAnyEditorOpen).toBe(false);
  });

  it('queues a second open while an editor is already open, then opens the queued one on confirm and closes the first', async () => {
    const { result } = renderHook(() => useChatWithEditors());

    act(() => {
      result.current.handleShowAgentEditor(AGENT);
    });
    expect(result.current.isEditingAgent).toBe(true);

    act(() => {
      result.current.handleShowPipelineEditor(PIPELINE);
    });

    // Queued, not opened immediately — the agent editor is still open, the
    // pipeline editor is not, and the mutex's own confirm flag is up.
    expect(result.current.isEditingPipeline).toBe(false);
    expect(result.current.mutex.openEditingAlert).toBe(true);

    act(() => {
      result.current.mutex.onConfirmCloseEditor();
    });

    // `onConfirmCloseEditor` closes the current editor synchronously...
    expect(result.current.isEditingAgent).toBe(false);
    // ...and opens the queued one via a real `setTimeout(..., 0)` — `waitFor`
    // polls until it fires.
    await waitFor(() => {
      expect(result.current.isEditingPipeline).toBe(true);
    });
    expect(result.current.mutex.openEditingAlert).toBe(false);
  });

  it('canvas/artifact editor stubs are inert (no-op, no throw) — disclosed gap', () => {
    const { result } = renderHook(() => useChatWithEditors());

    expect(() => {
      act(() => {
        result.current.mutex.onEditArtifact({ id: 'a1' });
      });
    }).not.toThrow();
    expect(() => {
      act(() => {
        result.current.mutex.onEditCanvas({}, {});
      });
    }).not.toThrow();
  });
});
