import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useEditToolkit } from './useEditToolkit';

function setupNavBlocker() {
  const setToolkitEditingBlockNav = vi.fn();
  const setToolkitCreateMode = vi.fn();
  return { isEditingToolkit: false, setToolkitEditingBlockNav, setToolkitCreateMode };
}

describe('useEditToolkit', () => {
  it('starts with no editing toolkit and create mode off', () => {
    const navBlocker = setupNavBlocker();
    const { result } = renderHook(() => useEditToolkit({ navBlocker }));

    expect(result.current.editingToolkit).toBeNull();
    expect(result.current.isToolkitCreateMode).toBe(false);
  });

  it('onShowToolkitEditor sets the editing toolkit and blocks navigation, not create mode', () => {
    const navBlocker = setupNavBlocker();
    const { result } = renderHook(() => useEditToolkit({ navBlocker }));

    act(() => result.current.onShowToolkitEditor({ id: 'tk-1' }));

    expect(result.current.editingToolkit).toEqual({ id: 'tk-1' });
    expect(result.current.isToolkitCreateMode).toBe(false);
    expect(navBlocker.setToolkitEditingBlockNav).toHaveBeenCalledWith(true);
  });

  it('onShowToolkitEditor is a no-op for a falsy toolkit', () => {
    const navBlocker = setupNavBlocker();
    const { result } = renderHook(() => useEditToolkit({ navBlocker }));

    act(() => result.current.onShowToolkitEditor(undefined as never));

    expect(result.current.editingToolkit).toBeNull();
    expect(navBlocker.setToolkitEditingBlockNav).not.toHaveBeenCalled();
  });

  it('onShowToolkitEditorCreator enters create mode with the requested isMCP flag', () => {
    const navBlocker = setupNavBlocker();
    const { result } = renderHook(() => useEditToolkit({ navBlocker }));

    act(() => result.current.onShowToolkitEditorCreator(true));

    expect(result.current.editingToolkit).toEqual({ isCreating: true, isMCP: true });
    expect(result.current.isToolkitCreateMode).toBe(true);
    expect(navBlocker.setToolkitEditingBlockNav).toHaveBeenCalledWith(true);
    expect(navBlocker.setToolkitCreateMode).toHaveBeenCalledWith(true);
  });

  it('onShowToolkitEditorCreator defaults isMCP to false', () => {
    const navBlocker = setupNavBlocker();
    const { result } = renderHook(() => useEditToolkit({ navBlocker }));

    act(() => result.current.onShowToolkitEditorCreator());

    expect(result.current.editingToolkit).toEqual({ isCreating: true, isMCP: false });
  });

  it('onToolkitEditorCreated switches from create mode to edit mode with the created toolkit', () => {
    const navBlocker = setupNavBlocker();
    const { result } = renderHook(() => useEditToolkit({ navBlocker }));

    act(() => result.current.onShowToolkitEditorCreator());
    act(() => result.current.onToolkitEditorCreated({ id: 'tk-99' }));

    expect(result.current.editingToolkit).toEqual({ id: 'tk-99' });
    expect(result.current.isToolkitCreateMode).toBe(false);
    expect(navBlocker.setToolkitCreateMode).toHaveBeenCalledWith(false);
  });

  it('onCloseToolkitEditor clears state and unblocks navigation', () => {
    const navBlocker = setupNavBlocker();
    const { result } = renderHook(() => useEditToolkit({ navBlocker }));

    act(() => result.current.onShowToolkitEditor({ id: 'tk-1' }));
    act(() => result.current.onCloseToolkitEditor());

    expect(result.current.editingToolkit).toBeNull();
    expect(result.current.isToolkitCreateMode).toBe(false);
    expect(navBlocker.setToolkitEditingBlockNav).toHaveBeenLastCalledWith(false);
    expect(navBlocker.setToolkitCreateMode).toHaveBeenLastCalledWith(false);
  });

  it('unmounting clears the nav-blocker flags', () => {
    const navBlocker = setupNavBlocker();
    const { unmount } = renderHook(() => useEditToolkit({ navBlocker }));

    unmount();

    expect(navBlocker.setToolkitEditingBlockNav).toHaveBeenLastCalledWith(false);
    expect(navBlocker.setToolkitCreateMode).toHaveBeenLastCalledWith(false);
  });
});
