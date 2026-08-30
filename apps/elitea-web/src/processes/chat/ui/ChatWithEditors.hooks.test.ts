import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Participant } from '@/entities/participant';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { useEditorStateStore } from '@/shared/lib/editorState';
import { server } from '@/test/setup';
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

const TOOLKIT: Participant = {
  id: '25',
  entityName: 'toolkit',
  entityMeta: { id: '20', name: 'OpenAPI Echo', projectId: 'proj-1' },
  meta: { mcp: false },
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

  it('handleShowToolkitEditor opens the near-chat toolkit editor with the toolkit identity', () => {
    const { result } = renderHook(() => useChatWithEditors());

    act(() => {
      result.current.handleShowToolkitEditor(TOOLKIT);
    });

    expect(result.current.isEditingToolkit).toBe(true);
    expect(result.current.editToolkit.editingToolkit).toEqual({
      id: '25',
      isMCP: false,
      entity_meta: { id: '20', project_id: 'proj-1', name: 'OpenAPI Echo' },
      meta: { mcp: false },
    });
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

  describe('toolkitWriteDeps', () => {
    beforeEach(() => {
      configureGeneratedClient({ baseUrl: '/api/v2' });
    });
    afterEach(() => {
      resetGeneratedClient();
    });

    // Regression: these two deps used to be `rejectToolkitWrite` — a stub
    // rejecting with "no backend endpoint yet" that went stale once Phase 1c
    // made the generated operations real, so EVERY toolkit create/save from
    // chat failed by construction. Both must hit the real endpoints.
    it('createToolkit POSTs the real generated create endpoint and returns its body', async () => {
      const seen: { projectId?: string; body?: unknown } = {};
      server.use(
        http.post('/api/v2/elitea_core/tools/prompt_lib/:projectId', async ({ request, params }) => {
          seen.projectId = String(params['projectId']);
          seen.body = await request.json();
          return HttpResponse.json({ id: '77', type: 'github', name: 'GitHub' });
        }),
      );
      const { result } = renderHook(() => useChatWithEditors());

      const created = await result.current.toolkitWriteDeps.createToolkit({ projectId: 'proj-1', type: 'github', settings: { key: 'v' } });

      expect(created).toMatchObject({ id: '77', type: 'github' });
      expect(seen.projectId).toBe('proj-1');
      expect(seen.body).toMatchObject({ type: 'github', settings: { key: 'v' } });
    });

    it('saveToolkit PUTs the real generated update endpoint', async () => {
      const seen: { toolId?: string } = {};
      server.use(
        http.put('/api/v2/elitea_core/tool/prompt_lib/:projectId/:toolId', ({ params }) => {
          seen.toolId = String(params['toolId']);
          return HttpResponse.json({ id: '77', type: 'github', name: 'GitHub renamed' });
        }),
      );
      const { result } = renderHook(() => useChatWithEditors());

      const saved = await result.current.toolkitWriteDeps.saveToolkit({ projectId: 'proj-1', toolId: '77', type: 'github', name: 'GitHub renamed' });

      expect(saved).toMatchObject({ name: 'GitHub renamed' });
      expect(seen.toolId).toBe('77');
    });
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
