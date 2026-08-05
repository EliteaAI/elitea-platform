import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useEditPipeline } from './useEditPipeline';

function buildNavBlocker(isEditingPipeline = false) {
  return {
    isEditingPipeline,
    setPipelineEditingBlockNav: vi.fn(),
  };
}

describe('useEditPipeline', () => {
  it('starts with no editing pipeline and not in create mode', () => {
    const navBlocker = buildNavBlocker();
    const { result } = renderHook(() => useEditPipeline({ navBlocker }));

    expect(result.current.editingPipeline).toBeNull();
    expect(result.current.isPipelineCreateMode).toBe(false);
    expect(result.current.sizes).toEqual([50, 50]);
  });

  it('onShowPipelineEditor sets the editing pipeline, exits create mode, blocks nav, and resets the split to 50/50', () => {
    const navBlocker = buildNavBlocker();
    const { result } = renderHook(() => useEditPipeline({ navBlocker }));

    act(() => result.current.onDragEnd([30, 70]));
    act(() => result.current.onShowPipelineEditor({ id: 'p1' }));

    expect(result.current.editingPipeline).toEqual({ id: 'p1' });
    expect(result.current.isPipelineCreateMode).toBe(false);
    expect(result.current.sizes).toEqual([50, 50]);
    expect(navBlocker.setPipelineEditingBlockNav).toHaveBeenCalledWith(true);
  });

  it('onShowPipelineEditor is a no-op for a falsy pipeline', () => {
    const navBlocker = buildNavBlocker();
    const { result } = renderHook(() => useEditPipeline({ navBlocker }));

    act(() => result.current.onShowPipelineEditor(null as never));

    expect(result.current.editingPipeline).toBeNull();
    expect(navBlocker.setPipelineEditingBlockNav).not.toHaveBeenCalled();
  });

  it('onShowPipelineEditorCreator clears the editing pipeline and enters create mode', () => {
    const navBlocker = buildNavBlocker();
    const { result } = renderHook(() => useEditPipeline({ navBlocker }));

    act(() => result.current.onShowPipelineEditor({ id: 'p1' }));
    act(() => result.current.onShowPipelineEditorCreator());

    expect(result.current.editingPipeline).toBeNull();
    expect(result.current.isPipelineCreateMode).toBe(true);
    expect(navBlocker.setPipelineEditingBlockNav).toHaveBeenLastCalledWith(true);
  });

  it('onClosePipelineEditor clears state, unblocks nav, and collapses the split to full width', () => {
    const navBlocker = buildNavBlocker();
    const { result } = renderHook(() => useEditPipeline({ navBlocker }));

    act(() => result.current.onShowPipelineEditor({ id: 'p1' }));
    act(() => result.current.onClosePipelineEditor());

    expect(result.current.editingPipeline).toBeNull();
    expect(result.current.isPipelineCreateMode).toBe(false);
    expect(result.current.sizes).toEqual([100, 0]);
    expect(navBlocker.setPipelineEditingBlockNav).toHaveBeenLastCalledWith(false);
  });

  it('onPipelineEditorCreated tags the created pipeline with participantType and exits create mode', () => {
    const navBlocker = buildNavBlocker();
    const { result } = renderHook(() => useEditPipeline({ navBlocker }));

    act(() => result.current.onShowPipelineEditorCreator());
    act(() => result.current.onPipelineEditorCreated({ id: 'new-1' }));

    expect(result.current.editingPipeline).toEqual({ id: 'new-1', participantType: 'pipeline' });
    expect(result.current.isPipelineCreateMode).toBe(false);
  });

  it('handlePipelineSaved notifies onChangeParticipantSettings with the previous pipeline and updates editingPipeline', () => {
    const navBlocker = buildNavBlocker();
    const { result } = renderHook(() => useEditPipeline({ navBlocker }));
    const onChangeParticipantSettings = vi.fn();

    act(() => result.current.onShowPipelineEditor({ id: 'p1' }));
    act(() => result.current.handlePipelineSaved({ id: 'p1', entity_meta: { id: 'p1' } }, onChangeParticipantSettings));

    expect(onChangeParticipantSettings).toHaveBeenCalledWith({ id: 'p1' }, { id: 'p1', entity_meta: { id: 'p1' } });
    expect(result.current.editingPipeline).toEqual({
      id: 'p1',
      entity_meta: { id: 'p1' },
      participantType: 'pipeline',
    });
  });

  it('handlePipelineSaved is a no-op without onChangeParticipantSettings', () => {
    const navBlocker = buildNavBlocker();
    const { result } = renderHook(() => useEditPipeline({ navBlocker }));

    act(() => result.current.onShowPipelineEditor({ id: 'p1' }));
    act(() => result.current.handlePipelineSaved({ id: 'p1' }));

    expect(result.current.editingPipeline).toEqual({ id: 'p1' });
  });

  it('unblocks nav on unmount', () => {
    const navBlocker = buildNavBlocker();
    const { unmount } = renderHook(() => useEditPipeline({ navBlocker }));

    unmount();

    expect(navBlocker.setPipelineEditingBlockNav).toHaveBeenCalledWith(false);
  });

  it('gutterStyle returns a stable col-resize style object', () => {
    const navBlocker = buildNavBlocker();
    const { result } = renderHook(() => useEditPipeline({ navBlocker }));

    expect(result.current.gutterStyle()).toEqual({ cursor: 'col-resize', pointerEvents: 'auto' });
  });
});
