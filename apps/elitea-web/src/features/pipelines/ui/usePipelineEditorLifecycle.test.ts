import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getGetApplicationVersionDetailMockHandler,
  getGetPublicApplicationMockHandler,
} from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import type { ApplicationCreatedResponse, ApplicationVersionDetail } from '@/shared/api/generated/model';

import type { usePipelineEditorCreate } from '../lib/usePipelineEditorCreate';
import { usePipelineEditorStore } from '../model/pipelineEditorStore';
import { usePipelineYamlStore } from '../model/pipelineYamlStore';
import { renderHookWithProviders } from '../__tests__/testUtils';
import {
  usePipelineConversationStartersSync,
  usePipelineEditorActions,
  usePipelineEditorHandle,
  usePipelineIdentityReset,
  usePipelineVersionQuery,
  usePipelineVersionSync,
} from './usePipelineEditorLifecycle';

const BASE = '/api/v2';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
  usePipelineYamlStore.setState({
    yamlCode: '',
    yamlJsonObject: {},
    initYamlCode: '',
    initYamlJsonObject: {},
    resetFlag: false,
    layoutVersion: undefined,
  });
  usePipelineEditorStore.setState({ nodes: [], edges: [], stateValidationErrors: {} });
});

afterEach(() => {
  resetGeneratedClient();
  vi.restoreAllMocks();
});

function makeVersionDetail(overrides: Partial<ApplicationVersionDetail> = {}): ApplicationVersionDetail {
  return {
    id: '7',
    application_id: '3',
    name: 'v1',
    status: 'draft',
    ...overrides,
  };
}

describe('usePipelineVersionQuery', () => {
  it('fetches nothing (both endpoints disabled) when isVisible is false', async () => {
    server.use(
      getGetApplicationVersionDetailMockHandler(() => {
        throw new Error('should not be called');
      }),
    );
    const { result } = renderHookWithProviders(() =>
      usePipelineVersionQuery({
        projectId: 'p1',
        pipelineId: 3,
        versionId: 7,
        isVisible: false,
        isCreateMode: false,
        isPublishedPipeline: false,
      }),
    );
    await waitFor(() => expect(result.current.versionDetails).toBeUndefined());
  });

  it('fetches the private endpoint when visible, not create mode, and not published', async () => {
    server.use(getGetApplicationVersionDetailMockHandler(makeVersionDetail({ id: '7', name: 'private-version' })));
    const { result } = renderHookWithProviders(() =>
      usePipelineVersionQuery({
        projectId: 'p1',
        pipelineId: 3,
        versionId: 7,
        isVisible: true,
        isCreateMode: false,
        isPublishedPipeline: false,
      }),
    );
    await waitFor(() => expect(result.current.versionDetails?.name).toBe('private-version'));
  });

  it('fetches the public endpoint (and unwraps version_details) when isPublishedPipeline is true', async () => {
    server.use(
      getGetPublicApplicationMockHandler({
        id: '3',
        name: 'public app',
        description: 'd',
        version_details: makeVersionDetail({ id: '9', name: 'public-version' }),
      }),
    );
    const { result } = renderHookWithProviders(() =>
      usePipelineVersionQuery({
        projectId: 'p1',
        pipelineId: 3,
        versionId: 9,
        isVisible: true,
        isCreateMode: false,
        isPublishedPipeline: true,
      }),
    );
    await waitFor(() => expect(result.current.versionDetails?.name).toBe('public-version'));
  });

  it('does not fetch either endpoint in create mode', async () => {
    let calls = 0;
    server.use(
      getGetApplicationVersionDetailMockHandler(() => {
        calls += 1;
        return makeVersionDetail();
      }),
      getGetPublicApplicationMockHandler(() => {
        calls += 1;
        return { id: '3', name: 'x', description: '', version_details: makeVersionDetail() };
      }),
    );
    renderHookWithProviders(() =>
      usePipelineVersionQuery({
        projectId: 'p1',
        pipelineId: 3,
        versionId: 7,
        isVisible: true,
        isCreateMode: true,
        isPublishedPipeline: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(0);
  });

  it('surfaces the public query error when isPublishedPipeline is true', async () => {
    server.use(http.get(`${BASE}/elitea_core/public_application/prompt_lib/:applicationId/:versionName`, () => HttpResponse.json({ error: 'nope' }, { status: 404 })));
    const { result } = renderHookWithProviders(() =>
      usePipelineVersionQuery({
        projectId: 'p1',
        pipelineId: 3,
        versionId: 7,
        isVisible: true,
        isCreateMode: false,
        isPublishedPipeline: true,
      }),
    );
    await waitFor(() => expect(result.current.fetchError).toBeTruthy());
  });

  it('surfaces the private query error when isPublishedPipeline is false', async () => {
    server.use(http.get(`${BASE}/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId`, () => HttpResponse.json({ error: 'nope' }, { status: 404 })));
    const { result } = renderHookWithProviders(() =>
      usePipelineVersionQuery({
        projectId: 'p1',
        pipelineId: 3,
        versionId: 7,
        isVisible: true,
        isCreateMode: false,
        isPublishedPipeline: false,
      }),
    );
    await waitFor(() => expect(result.current.fetchError).toBeTruthy());
  });

  it('refetchPrivate() re-runs the private query without throwing', async () => {
    let calls = 0;
    server.use(
      getGetApplicationVersionDetailMockHandler(() => {
        calls += 1;
        return makeVersionDetail({ name: `call-${calls}` });
      }),
    );
    const { result } = renderHookWithProviders(() =>
      usePipelineVersionQuery({
        projectId: 'p1',
        pipelineId: 3,
        versionId: 7,
        isVisible: true,
        isCreateMode: false,
        isPublishedPipeline: false,
      }),
    );
    await waitFor(() => expect(result.current.versionDetails?.name).toBe('call-1'));
    result.current.refetchPrivate();
    await waitFor(() => expect(result.current.versionDetails?.name).toBe('call-2'));
  });
});

describe('usePipelineIdentityReset', () => {
  it('calls onReset and resets both zustand stores on mount, and again when pipelineEntityId changes', () => {
    usePipelineEditorStore.setState({ nodes: [{ id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: {} }], edges: [] });
    const onReset = vi.fn();

    const { rerender } = renderHookWithProviders(({ id }: { id: string | number | undefined }) =>
      usePipelineIdentityReset({ isCreateMode: false, pipelineEntityId: id, onReset }),
      undefined,
      { initialProps: { id: 1 } },
    );

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(usePipelineEditorStore.getState().nodes).toEqual([]);

    usePipelineEditorStore.setState({ nodes: [{ id: 'n2', type: 'agent', position: { x: 0, y: 0 }, data: {} }], edges: [] });
    rerender({ id: 2 });

    expect(onReset).toHaveBeenCalledTimes(2);
    expect(usePipelineEditorStore.getState().nodes).toEqual([]);
  });

  it('does not re-run the reset effect when isCreateMode/pipelineEntityId are unchanged across a rerender', () => {
    const onReset = vi.fn();
    const { rerender } = renderHookWithProviders(({ id }: { id: string | number | undefined }) =>
      usePipelineIdentityReset({ isCreateMode: false, pipelineEntityId: id, onReset }),
      undefined,
      { initialProps: { id: 1 } },
    );
    expect(onReset).toHaveBeenCalledTimes(1);
    rerender({ id: 1 });
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe('usePipelineVersionSync', () => {
  it('does nothing in create mode', () => {
    renderHookWithProviders(() =>
      usePipelineVersionSync({ isCreateMode: true, versionDetails: makeVersionDetail({ instructions: 'nodes: []' }), versionId: 7 }),
    );
    expect(usePipelineYamlStore.getState().yamlCode).toBe('');
  });

  it('does nothing when the version id does not match the current versionId', () => {
    renderHookWithProviders(() =>
      usePipelineVersionSync({ isCreateMode: false, versionDetails: makeVersionDetail({ id: '7', instructions: 'nodes: []' }), versionId: 999 }),
    );
    expect(usePipelineYamlStore.getState().yamlCode).toBe('');
  });

  it('parses valid YAML instructions, lays out the graph, and initializes both stores', () => {
    const instructions = 'nodes:\n  - id: entry_point\n    type: entry_point\n';
    renderHookWithProviders(() =>
      usePipelineVersionSync({ isCreateMode: false, versionDetails: makeVersionDetail({ id: '7', instructions }), versionId: 7 }),
    );

    expect(usePipelineYamlStore.getState().yamlCode).toBe(instructions);
    expect(usePipelineYamlStore.getState().yamlJsonObject).toEqual({ nodes: [{ id: 'entry_point', type: 'entry_point' }] });
  });

  it('silently no-ops on invalid (unparsable) YAML', () => {
    renderHookWithProviders(() =>
      usePipelineVersionSync({ isCreateMode: false, versionDetails: makeVersionDetail({ id: '7', instructions: '{{{not: valid: yaml' }), versionId: 7 }),
    );
    expect(usePipelineYamlStore.getState().yamlCode).toBe('');
  });

  it('re-uses saved node positions from pipeline_settings.nodes when present', () => {
    const instructions = 'nodes:\n  - id: entry_point\n    type: entry_point\n';
    renderHookWithProviders(() =>
      usePipelineVersionSync({
        isCreateMode: false,
        versionDetails: makeVersionDetail({
          id: '7',
          instructions,
          pipeline_settings: { nodes: [{ id: 'entry_point', position: { x: 42, y: 99 } }] },
        }),
        versionId: 7,
      }),
    );
    expect(usePipelineYamlStore.getState().yamlCode).toBe(instructions);
  });

  it('ignores a non-array pipeline_settings.nodes value (defensive readSavedNodes narrowing)', () => {
    const instructions = 'nodes:\n  - id: entry_point\n    type: entry_point\n';
    renderHookWithProviders(() =>
      usePipelineVersionSync({
        isCreateMode: false,
        versionDetails: makeVersionDetail({ id: '7', instructions, pipeline_settings: { nodes: 'not-an-array' as unknown as never } }),
        versionId: 7,
      }),
    );
    expect(usePipelineYamlStore.getState().yamlCode).toBe(instructions);
  });

  it('does not re-initialize when versionDetails.instructions is unchanged on rerender', () => {
    const instructions = 'nodes:\n  - id: entry_point\n    type: entry_point\n';
    const versionDetails = makeVersionDetail({ id: '7', instructions });

    const { rerender } = renderHookWithProviders(
      ({ vd }: { vd: ApplicationVersionDetail }) => usePipelineVersionSync({ isCreateMode: false, versionDetails: vd, versionId: 7 }),
      undefined,
      { initialProps: { vd: versionDetails } },
    );

    // Mark the store dirty in a way `resetPipelineEditor` would clear, to detect a second run.
    usePipelineEditorStore.getState().setNodes([{ id: 'manual', type: 'agent', position: { x: 1, y: 1 }, data: {} }]);

    rerender({ vd: { ...versionDetails } });

    // Same `instructions` string -> guarded, so the manual node survives untouched.
    expect(usePipelineEditorStore.getState().nodes).toEqual([{ id: 'manual', type: 'agent', position: { x: 1, y: 1 }, data: {} }]);
  });

  it('treats a missing versionDetails.id as a no-op', () => {
    renderHookWithProviders(() =>
      usePipelineVersionSync({ isCreateMode: false, versionDetails: undefined, versionId: 7 }),
    );
    expect(usePipelineYamlStore.getState().yamlCode).toBe('');
  });
});

describe('usePipelineEditorHandle', () => {
  function makeRef(overrides: Partial<{ onRcvAgentEvent: (event: unknown) => void; deleteAllRunNodes: () => void; onStopRun: () => void }> = {}) {
    return {
      current: {
        onRcvAgentEvent: vi.fn(),
        deleteAllRunNodes: vi.fn(),
        onStopRun: vi.fn(),
        ...overrides,
      },
    };
  }

  it('forwards onRcvAgentEvent only when activeParticipantId matches pipelineId', () => {
    const editorPanelRef = makeRef();
    const { result, rerender } = renderHookWithProviders(
      ({ activeParticipantId }: { activeParticipantId: string | number | undefined }) =>
        usePipelineEditorHandle({ editorPanelRef, pipelineId: 5, activeParticipantId, stopRunOnNodeStop: vi.fn() }),
      undefined,
      { initialProps: { activeParticipantId: 9 } },
    );

    result.current.onRcvAgentEvent({ type: 'x' });
    expect(editorPanelRef.current.onRcvAgentEvent).not.toHaveBeenCalled();

    rerender({ activeParticipantId: 5 });
    result.current.onRcvAgentEvent({ type: 'x' });
    expect(editorPanelRef.current.onRcvAgentEvent).toHaveBeenCalledWith({ type: 'x' });
  });

  it('deleteAllRunNodes forwards to the ref', () => {
    const editorPanelRef = makeRef();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorHandle({ editorPanelRef, pipelineId: 5, activeParticipantId: 5, stopRunOnNodeStop: vi.fn() }),
    );
    result.current.deleteAllRunNodes();
    expect(editorPanelRef.current.deleteAllRunNodes).toHaveBeenCalledTimes(1);
  });

  it('onStopRun(true) (chat) calls the ref onStopRun', () => {
    const editorPanelRef = makeRef();
    const stopRunOnNodeStop = vi.fn();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorHandle({ editorPanelRef, pipelineId: 5, activeParticipantId: 5, stopRunOnNodeStop }),
    );
    result.current.onStopRun(true);
    expect(editorPanelRef.current.onStopRun).toHaveBeenCalledTimes(1);
    expect(stopRunOnNodeStop).not.toHaveBeenCalled();
  });

  it('onStopRun(false) (node) calls stopRunOnNodeStop(true) instead', () => {
    const editorPanelRef = makeRef();
    const stopRunOnNodeStop = vi.fn();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorHandle({ editorPanelRef, pipelineId: 5, activeParticipantId: 5, stopRunOnNodeStop }),
    );
    result.current.onStopRun(false);
    expect(editorPanelRef.current.onStopRun).not.toHaveBeenCalled();
    expect(stopRunOnNodeStop).toHaveBeenCalledWith(true);
  });

  it('onStopRun(false) does not throw when stopRunOnNodeStop is undefined', () => {
    const editorPanelRef = makeRef();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorHandle({ editorPanelRef, pipelineId: 5, activeParticipantId: 5, stopRunOnNodeStop: undefined }),
    );
    expect(() => result.current.onStopRun(false)).not.toThrow();
  });
});

function makeCreate(overrides: Partial<ReturnType<typeof usePipelineEditorCreate>> = {}): ReturnType<typeof usePipelineEditorCreate> {
  return {
    values: { name: 'n', description: 'd', version_details: { instructions: '', welcome_message: '', tags: [], variables: [], meta: { step_limit: 25 } } },
    onFieldChange: vi.fn(),
    submit: vi.fn(),
    isCreating: false,
    error: null,
    ...overrides,
  };
}

describe('usePipelineEditorActions', () => {
  it('handleCreateSubmit calls onPipelineCreated with the participantType tag when create.submit() resolves a result', async () => {
    const created: ApplicationCreatedResponse = {
      id: '1',
      name: 'n',
      description: 'd',
      type: 'interface',
      icon: '',
      owner_id: 'u1',
      created_at: '2026-01-01T00:00:00Z',
    };
    const submit = vi.fn().mockResolvedValue(created);
    const onPipelineCreated = vi.fn();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorActions({
        isCreateMode: true,
        pipelineEntityId: undefined,
        create: makeCreate({ submit }),
        onPipelineCreated,
        onPipelineSaved: undefined,
        onAttachmentToolChange: undefined,
        refetchPrivate: vi.fn(),
        setIsDirty: vi.fn(),
        setIsYamlDirty: vi.fn(),
      }),
    );

    await result.current.handleCreateSubmit();
    expect(onPipelineCreated).toHaveBeenCalledWith(expect.objectContaining({ id: '1', participantType: 'pipeline' }));
  });

  it('handleCreateSubmit does not call onPipelineCreated when create.submit() resolves undefined', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const onPipelineCreated = vi.fn();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorActions({
        isCreateMode: true,
        pipelineEntityId: undefined,
        create: makeCreate({ submit }),
        onPipelineCreated,
        onPipelineSaved: undefined,
        onAttachmentToolChange: undefined,
        refetchPrivate: vi.fn(),
        setIsDirty: vi.fn(),
        setIsYamlDirty: vi.fn(),
      }),
    );

    await result.current.handleCreateSubmit();
    expect(onPipelineCreated).not.toHaveBeenCalled();
  });

  it('handleDiscard resets dirty flags and both zustand stores', () => {
    usePipelineEditorStore.setState({ nodes: [{ id: 'n', type: 'agent', position: { x: 0, y: 0 }, data: {} }], edges: [] });
    const setIsDirty = vi.fn();
    const setIsYamlDirty = vi.fn();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorActions({
        isCreateMode: false,
        pipelineEntityId: 1,
        create: makeCreate(),
        onPipelineCreated: undefined,
        onPipelineSaved: undefined,
        onAttachmentToolChange: undefined,
        refetchPrivate: vi.fn(),
        setIsDirty,
        setIsYamlDirty,
      }),
    );

    result.current.handleDiscard();
    expect(setIsDirty).toHaveBeenCalledWith(false);
    expect(setIsYamlDirty).toHaveBeenCalledWith(false);
    expect(usePipelineEditorStore.getState().nodes).toEqual([]);
  });

  it('handleSaveSuccess resets dirty flags and forwards to onAttachmentToolChange/onPipelineSaved', () => {
    const setIsDirty = vi.fn();
    const setIsYamlDirty = vi.fn();
    const onAttachmentToolChange = vi.fn();
    const onPipelineSaved = vi.fn();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorActions({
        isCreateMode: false,
        pipelineEntityId: 5,
        create: makeCreate(),
        onPipelineCreated: undefined,
        onPipelineSaved,
        onAttachmentToolChange,
        refetchPrivate: vi.fn(),
        setIsDirty,
        setIsYamlDirty,
      }),
    );

    result.current.handleSaveSuccess({ some: 'data' });
    expect(setIsDirty).toHaveBeenCalledWith(false);
    expect(setIsYamlDirty).toHaveBeenCalledWith(false);
    expect(onAttachmentToolChange).toHaveBeenCalledWith(5);
    expect(onPipelineSaved).toHaveBeenCalledWith({ some: 'data' });
  });

  it('handleSaveSuccess does not throw when the optional callbacks are undefined', () => {
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorActions({
        isCreateMode: false,
        pipelineEntityId: 5,
        create: makeCreate(),
        onPipelineCreated: undefined,
        onPipelineSaved: undefined,
        onAttachmentToolChange: undefined,
        refetchPrivate: vi.fn(),
        setIsDirty: vi.fn(),
        setIsYamlDirty: vi.fn(),
      }),
    );
    expect(() => result.current.handleSaveSuccess({})).not.toThrow();
  });

  it('handleAttachmentToolChange refetches when not in create mode', () => {
    const onAttachmentToolChange = vi.fn();
    const refetchPrivate = vi.fn();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorActions({
        isCreateMode: false,
        pipelineEntityId: 5,
        create: makeCreate(),
        onPipelineCreated: undefined,
        onPipelineSaved: undefined,
        onAttachmentToolChange,
        refetchPrivate,
        setIsDirty: vi.fn(),
        setIsYamlDirty: vi.fn(),
      }),
    );
    result.current.handleAttachmentToolChange();
    expect(onAttachmentToolChange).toHaveBeenCalledWith(5);
    expect(refetchPrivate).toHaveBeenCalledTimes(1);
  });

  it('handleAttachmentToolChange does not refetch in create mode', () => {
    const refetchPrivate = vi.fn();
    const { result } = renderHookWithProviders(() =>
      usePipelineEditorActions({
        isCreateMode: true,
        pipelineEntityId: undefined,
        create: makeCreate(),
        onPipelineCreated: undefined,
        onPipelineSaved: undefined,
        onAttachmentToolChange: undefined,
        refetchPrivate,
        setIsDirty: vi.fn(),
        setIsYamlDirty: vi.fn(),
      }),
    );
    result.current.handleAttachmentToolChange();
    expect(refetchPrivate).not.toHaveBeenCalled();
  });

  it('canSaveCreate is true for valid create.values and false when name/description are blank', () => {
    const { result: valid } = renderHookWithProviders(() =>
      usePipelineEditorActions({
        isCreateMode: true,
        pipelineEntityId: undefined,
        create: makeCreate(),
        onPipelineCreated: undefined,
        onPipelineSaved: undefined,
        onAttachmentToolChange: undefined,
        refetchPrivate: vi.fn(),
        setIsDirty: vi.fn(),
        setIsYamlDirty: vi.fn(),
      }),
    );
    expect(valid.current.canSaveCreate).toBe(true);

    const { result: invalid } = renderHookWithProviders(() =>
      usePipelineEditorActions({
        isCreateMode: true,
        pipelineEntityId: undefined,
        create: makeCreate({ values: { name: '', description: '', version_details: { instructions: '', welcome_message: '', tags: [], variables: [], meta: { step_limit: 25 } } } }),
        onPipelineCreated: undefined,
        onPipelineSaved: undefined,
        onAttachmentToolChange: undefined,
        refetchPrivate: vi.fn(),
        setIsDirty: vi.fn(),
        setIsYamlDirty: vi.fn(),
      }),
    );
    expect(invalid.current.canSaveCreate).toBe(false);
  });
});

describe('usePipelineConversationStartersSync', () => {
  it('calls the provided useConversationStartersSync hook with onConversationStartersChange', () => {
    const useConversationStartersSync = vi.fn();
    const onConversationStartersChange = vi.fn();
    renderHookWithProviders(() => usePipelineConversationStartersSync(useConversationStartersSync, onConversationStartersChange));
    expect(useConversationStartersSync).toHaveBeenCalledWith(onConversationStartersChange);
  });

  it('does not throw when useConversationStartersSync is undefined (falls back to the no-op)', () => {
    expect(() => {
      renderHookWithProviders(() => usePipelineConversationStartersSync(undefined, vi.fn()));
    }).not.toThrow();
  });
});
