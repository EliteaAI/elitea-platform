import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { installWebStorageShim } from '../../../test/webstorage';

import { useAiAssistantLanguageLinter } from './useAiAssistantLanguageLinter';

installWebStorageShim();

describe('useAiAssistantLanguageLinter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('initializes language from defaultLanguage when supplied', () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('json', null, false));
    expect(result.current.language).toBe('json');
  });

  it('falls back to the persisted content-type, then "text"', () => {
    localStorage.setItem('el.pipelines.ai-assistant.editor-content-type', 'jinja');
    const { result } = renderHook(() => useAiAssistantLanguageLinter(undefined, null, false));
    expect(result.current.language).toBe('jinja');
  });

  it('falls back to "text" when nothing else is set', () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter(undefined, null, false));
    expect(result.current.language).toBe('text');
  });

  it('produces a non-empty extensions array for json (highlighting + linter)', async () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('json', null, false));
    await waitFor(() => expect(result.current.extensions.length).toBeGreaterThan(0));
  });

  it('drops the json syntax-highlighting/linter bundle down to the plain highlight-free bucket while isGenerating', async () => {
    const { result, rerender } = renderHook(({ isGenerating }) => useAiAssistantLanguageLinter('json', null, isGenerating), {
      initialProps: { isGenerating: false },
    });
    await waitFor(() => expect(result.current.extensions.length).toBe(2)); // json() + linter(jsonParseLinter())

    rerender({ isGenerating: true });

    await waitFor(() => expect(result.current.extensions.length).toBe(1)); // json() only, linter dropped
  });

  it('produces an empty extensions array for text while isGenerating (linter suppressed)', async () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('text', null, true));
    await waitFor(() => expect(result.current.extensions).toEqual([]));
  });

  it('onChangeLanguage updates language and persists to storage', () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('text', null, false));
    result.current.onChangeLanguage('jinja');
    expect(localStorage.getItem('el.pipelines.ai-assistant.editor-content-type')).toBe('jinja');
  });

  it('onChangeLanguage clears diagnostics on the supplied editor view', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'abc' }) });
    const dispatchSpy = vi.spyOn(view, 'dispatch');
    const { result } = renderHook(() => useAiAssistantLanguageLinter('text', view, false));

    result.current.onChangeLanguage('json');

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('does not throw when editorView is null on language change', () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('text', null, false));
    expect(() => result.current.onChangeLanguage('json')).not.toThrow();
  });
});
