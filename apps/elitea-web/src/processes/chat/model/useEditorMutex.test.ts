import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useEditorStateStore } from '@/shared/lib/editorState';

import { useEditorMutex } from './useEditorMutex';
import type { UseEditorMutexParams } from './useEditorMutex';

function buildParams(overrides: Partial<UseEditorMutexParams> = {}): UseEditorMutexParams {
  return {
    onShowAgentEditor: vi.fn(),
    onCloseAgentEditor: vi.fn(),
    onShowToolkitEditor: vi.fn(),
    onCloseToolkitEditor: vi.fn(),
    onShowPipelineEditor: vi.fn(),
    onClosePipelineEditor: vi.fn(),
    onShowCanvasEditor: vi.fn(),
    canvasEditorRef: { current: { save: vi.fn() } },
    onShowArtifactEditor: vi.fn(),
    onCloseArtifactEditor: vi.fn(),
    onShowAgentEditorCreator: vi.fn(),
    onShowToolkitEditorCreator: vi.fn(),
    onShowPipelineEditorCreator: vi.fn(),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useEditorMutex', () => {
  afterEach(() => {
    useEditorStateStore.setState({
      isEditingAgent: false,
      isEditingPipeline: false,
      isEditingToolkit: false,
      isEditingCanvas: false,
      isEditingArtifact: false,
      isAnyEditorOpen: false,
    });
  });

  it('opens directly when no editor is open', () => {
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onEditAgent({ id: 'a1' }));

    expect(params.onShowAgentEditor).toHaveBeenCalledWith({ id: 'a1' });
    expect(result.current.openEditingAlert).toBe(false);
  });

  it('queues the open and raises the alert when another editor is open', () => {
    useEditorStateStore.setState({ isEditingAgent: true, isAnyEditorOpen: true });
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onEditToolkit({ id: 't1' }));

    expect(params.onShowToolkitEditor).not.toHaveBeenCalled();
    expect(result.current.openEditingAlert).toBe(true);
  });

  it('onConfirmCloseEditor closes the currently-open editor then opens the queued one', async () => {
    useEditorStateStore.setState({ isEditingAgent: true, isAnyEditorOpen: true });
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onEditToolkit({ id: 't1' }));
    act(() => result.current.onConfirmCloseEditor());
    await flush();

    expect(params.onCloseAgentEditor).toHaveBeenCalledTimes(1);
    expect(params.onShowToolkitEditor).toHaveBeenCalledWith({ id: 't1' });
    expect(result.current.openEditingAlert).toBe(false);
  });

  it('onCloseEditorAlert cancels without opening anything', async () => {
    useEditorStateStore.setState({ isEditingAgent: true, isAnyEditorOpen: true });
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onEditPipeline({ id: 'p1' }));
    act(() => result.current.onCloseEditorAlert());
    expect(result.current.openEditingAlert).toBe(false);

    act(() => result.current.onConfirmCloseEditor());
    await flush();
    expect(params.onShowPipelineEditor).not.toHaveBeenCalled();
  });

  it('canvas close handler calls canvasEditorRef.current.save() when confirming over an open canvas editor', async () => {
    useEditorStateStore.setState({ isEditingCanvas: true, isAnyEditorOpen: true });
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onEditAgent({ id: 'a1' }));
    act(() => result.current.onConfirmCloseEditor());
    await flush();

    expect(params.canvasEditorRef.current?.save).toHaveBeenCalledTimes(1);
    expect(params.onShowAgentEditor).toHaveBeenCalledWith({ id: 'a1' });
  });

  it('onEditCanvas merges message into the payload and opens directly when free', () => {
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onEditCanvas('hello', { rawData: 'code', canvasId: 'c1' }));

    expect(params.onShowCanvasEditor).toHaveBeenCalledWith({ rawData: 'code', canvasId: 'c1' });
  });

  it('onCreateAgent/onCreateToolkit/onCreatePipeline open directly when free', () => {
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onCreateAgent());
    act(() => result.current.onCreateToolkit(true));
    act(() => result.current.onCreatePipeline());

    expect(params.onShowAgentEditorCreator).toHaveBeenCalledTimes(1);
    expect(params.onShowToolkitEditorCreator).toHaveBeenCalledWith(true);
    expect(params.onShowPipelineEditorCreator).toHaveBeenCalledTimes(1);
  });

  it('onCreateToolkit queues creation (with isMCP) when another editor is open', async () => {
    useEditorStateStore.setState({ isEditingAgent: true, isAnyEditorOpen: true });
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onCreateToolkit(true));
    expect(result.current.openEditingAlert).toBe(true);

    act(() => result.current.onConfirmCloseEditor());
    await flush();
    expect(params.onShowToolkitEditorCreator).toHaveBeenCalledWith(true);
  });

  it('onEditCanvas queues (with the message folded into the payload) instead of opening when another editor is open', () => {
    useEditorStateStore.setState({ isEditingAgent: true, isAnyEditorOpen: true });
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onEditCanvas('hello', { rawData: 'code', canvasId: 'c1' }));

    expect(params.onShowCanvasEditor).not.toHaveBeenCalled();
    expect(result.current.openEditingAlert).toBe(true);
  });

  it('onCreateAgent queues creation when another editor is open', async () => {
    useEditorStateStore.setState({ isEditingToolkit: true, isAnyEditorOpen: true });
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onCreateAgent());
    expect(params.onShowAgentEditorCreator).not.toHaveBeenCalled();
    expect(result.current.openEditingAlert).toBe(true);

    act(() => result.current.onConfirmCloseEditor());
    await flush();
    expect(params.onCloseToolkitEditor).toHaveBeenCalledTimes(1);
    expect(params.onShowAgentEditorCreator).toHaveBeenCalledTimes(1);
  });

  it('onCreatePipeline queues creation when another editor is open', async () => {
    useEditorStateStore.setState({ isEditingArtifact: true, isAnyEditorOpen: true });
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onCreatePipeline());
    expect(params.onShowPipelineEditorCreator).not.toHaveBeenCalled();
    expect(result.current.openEditingAlert).toBe(true);

    act(() => result.current.onConfirmCloseEditor());
    await flush();
    expect(params.onCloseArtifactEditor).toHaveBeenCalledTimes(1);
    expect(params.onShowPipelineEditorCreator).toHaveBeenCalledTimes(1);
  });

  it('closes over the correct editor kind for toolkit/pipeline/artifact too (getCurrentEditorKind\'s remaining branches)', async () => {
    useEditorStateStore.setState({ isEditingPipeline: true, isAnyEditorOpen: true });
    const params = buildParams();
    const { result } = renderHook(() => useEditorMutex(params));

    act(() => result.current.onEditArtifact({ id: 'art1' }));
    act(() => result.current.onConfirmCloseEditor());
    await flush();

    expect(params.onClosePipelineEditor).toHaveBeenCalledTimes(1);
    expect(params.onShowArtifactEditor).toHaveBeenCalledWith({ id: 'art1' });
  });
});
