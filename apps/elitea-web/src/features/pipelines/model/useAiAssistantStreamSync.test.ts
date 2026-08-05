import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAiAssistantStreamSync } from './useAiAssistantStreamSync';
import type { UseAiAssistantStreamSyncOptions } from './useAiAssistantStreamSync';

function makeOptions(overrides: Partial<UseAiAssistantStreamSyncOptions> = {}): UseAiAssistantStreamSyncOptions {
  return {
    streamedContent: '',
    isGenerating: false,
    showSplitView: false,
    hasError: false,
    setCurrentValue: vi.fn(),
    setImprovedContent: vi.fn(),
    handleBlur: vi.fn(),
    updateLanguageIfChanged: vi.fn(),
    clearPrompt: vi.fn(),
    ...overrides,
  };
}

describe('useAiAssistantStreamSync', () => {
  it('mirrors streamedContent into currentValue in single view', () => {
    const setCurrentValue = vi.fn();
    const { rerender } = renderHook((props) => useAiAssistantStreamSync(props), {
      initialProps: makeOptions({ setCurrentValue }),
    });
    rerender(makeOptions({ streamedContent: 'hello', setCurrentValue }));
    expect(setCurrentValue).toHaveBeenCalledWith('hello');
  });

  it('mirrors streamedContent into improvedContent in split view', () => {
    const setImprovedContent = vi.fn();
    const setCurrentValue = vi.fn();
    const { rerender } = renderHook((props) => useAiAssistantStreamSync(props), {
      initialProps: makeOptions({ showSplitView: true, setImprovedContent, setCurrentValue }),
    });
    rerender(makeOptions({ showSplitView: true, streamedContent: 'improved text', setImprovedContent, setCurrentValue }));
    expect(setImprovedContent).toHaveBeenCalledWith('improved text');
    expect(setCurrentValue).not.toHaveBeenCalled();
  });

  it('auto-commits via handleBlur when generation finishes in single view with no error', () => {
    const handleBlur = vi.fn();
    const updateLanguageIfChanged = vi.fn();
    const clearPrompt = vi.fn();
    const { rerender } = renderHook((props) => useAiAssistantStreamSync(props), {
      initialProps: makeOptions({ isGenerating: true, streamedContent: 'final', handleBlur, updateLanguageIfChanged, clearPrompt }),
    });
    rerender(makeOptions({ isGenerating: false, streamedContent: 'final', handleBlur, updateLanguageIfChanged, clearPrompt }));

    expect(updateLanguageIfChanged).toHaveBeenCalledWith('final');
    expect(handleBlur).toHaveBeenCalledWith('final');
    expect(clearPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not clear the prompt when generation finishes with an error', () => {
    const handleBlur = vi.fn();
    const clearPrompt = vi.fn();
    const { rerender } = renderHook((props) => useAiAssistantStreamSync(props), {
      initialProps: makeOptions({ isGenerating: true, streamedContent: 'oops', hasError: true, handleBlur, clearPrompt }),
    });
    rerender(makeOptions({ isGenerating: false, streamedContent: 'oops', hasError: true, handleBlur, clearPrompt }));

    expect(handleBlur).toHaveBeenCalledWith('oops');
    expect(clearPrompt).not.toHaveBeenCalled();
  });

  it('in split view, only clears the prompt on completion (does not call handleBlur)', () => {
    const handleBlur = vi.fn();
    const clearPrompt = vi.fn();
    const { rerender } = renderHook((props) => useAiAssistantStreamSync(props), {
      initialProps: makeOptions({ isGenerating: true, showSplitView: true, streamedContent: 'x', handleBlur, clearPrompt }),
    });
    rerender(makeOptions({ isGenerating: false, showSplitView: true, streamedContent: 'x', handleBlur, clearPrompt }));

    expect(handleBlur).not.toHaveBeenCalled();
    expect(clearPrompt).toHaveBeenCalledTimes(1);
  });

  it('does nothing when isGenerating was never true (no false->true transition observed)', () => {
    const handleBlur = vi.fn();
    const clearPrompt = vi.fn();
    const { rerender } = renderHook((props) => useAiAssistantStreamSync(props), {
      initialProps: makeOptions({ handleBlur, clearPrompt }),
    });
    rerender(makeOptions({ streamedContent: 'x', handleBlur, clearPrompt }));

    expect(handleBlur).not.toHaveBeenCalled();
    expect(clearPrompt).not.toHaveBeenCalled();
  });
});
