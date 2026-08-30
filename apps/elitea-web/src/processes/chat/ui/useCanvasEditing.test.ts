/**
 * The composition point that was a documented no-op.
 *
 * `ChatWithEditors.hooks.ts` shipped `onShowCanvasEditor` as `() => {}` and
 * a `canvasEditorRef` whose `.current` was permanently `null`. That broke
 * two things: opening a canvas did nothing, and `useEditorMutex`'s
 * `closeHandlers.isEditingCanvas` — the save-before-swap branch — resolved
 * to `null?.save?.()` and threw the user's edits away without a word.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useEditorStateStore } from '@/shared/lib/editorState';

import { toSelectedCodeBlockInfo, useCanvasEditing } from './useCanvasEditing';

afterEach(() => {
  useEditorStateStore.getState().setEditingCanvas(false);
});

describe('toSelectedCodeBlockInfo', () => {
  it('narrows the opaque payload into the editor props', () => {
    const info = toSelectedCodeBlockInfo({
      codeBlock: 'const a = 1;',
      language: 'javascript',
      isBlock: true,
      canvasId: 'cv-1',
      messageItemId: 42,
      viewOnly: true,
    });
    expect(info).toEqual({
      codeBlock: 'const a = 1;',
      language: 'javascript',
      isBlock: true,
      canvasId: 'cv-1',
      messageItemId: 42,
      viewOnly: true,
    });
  });

  it('defaults a missing language rather than passing undefined down', () => {
    expect(toSelectedCodeBlockInfo({ codeBlock: 'x' })?.language).toBe('markdown');
  });

  /*
   * A payload with no code block opens nothing. `CanvasEditor`'s own first
   * guard renders `display: none` for that case, so flipping
   * `isEditingCanvas` would wedge the mutex: every other editor would queue
   * behind a canvas nobody can see or close.
   */
  it('refuses a payload with no code block', () => {
    expect(toSelectedCodeBlockInfo({})).toBeUndefined();
    expect(toSelectedCodeBlockInfo({ codeBlock: '' })).toBeUndefined();
    expect(toSelectedCodeBlockInfo({ codeBlock: 42 })).toBeUndefined();
  });
});

describe('useCanvasEditing', () => {
  it('opens the canvas and raises the shared isEditingCanvas flag', () => {
    const { result } = renderHook(() => useCanvasEditing());
    expect(result.current.isEditingCanvas).toBe(false);

    act(() => result.current.onShowCanvasEditor({ codeBlock: 'hello', language: 'markdown', isBlock: true }));

    expect(result.current.isEditingCanvas).toBe(true);
    expect(result.current.selectedCodeBlockInfo?.codeBlock).toBe('hello');
    // The flag the editor mutex and the nav blocker both read.
    expect(useEditorStateStore.getState().isAnyEditorOpen).toBe(true);
  });

  it('closes and clears the selection', () => {
    const { result } = renderHook(() => useCanvasEditing());
    act(() => result.current.onShowCanvasEditor({ codeBlock: 'hello' }));
    act(() => { result.current.onCloseCanvasEditor(); });

    expect(result.current.isEditingCanvas).toBe(false);
    expect(result.current.selectedCodeBlockInfo).toBeUndefined();
  });

  it('does not open for a payload with no code block', () => {
    const { result } = renderHook(() => useCanvasEditing());
    act(() => result.current.onShowCanvasEditor({ language: 'markdown' }));
    expect(result.current.isEditingCanvas).toBe(false);
  });

  /*
   * The ref is what `useEditorMutex.closeHandlers.isEditingCanvas` calls
   * `.save()` on. It must be a real ref object the caller can attach — the
   * stub returned one whose `.current` nothing ever wrote.
   */
  it('hands back an attachable ref for the mutex to save through', () => {
    const { result } = renderHook(() => useCanvasEditing());
    expect(result.current.canvasEditorRef).toHaveProperty('current');
    let saved = false;
    result.current.canvasEditorRef.current = { save: () => { saved = true; } };
    result.current.canvasEditorRef.current.save();
    expect(saved).toBe(true);
  });
});
