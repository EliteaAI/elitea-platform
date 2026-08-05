import { useEffect, useRef } from 'react';

/**
 * Extracted from `AIAssistantModal.jsx`'s own effect body (baseline lines
 * 128-164, unit A2a) so the component's own `useEffect` count stays under
 * the §3.5 budget (3 per component) — same "extract hooks" fix
 * `scripts/lib/budgets-core.mjs`'s own finding message suggests, and the
 * same technique `shared/ui/ExpandedViewerModal`'s `useTitleTruncation`
 * already applies (unit S1-H).
 *
 * Owns 2 behaviours, unchanged from baseline:
 *  1. Mirrors `streamedContent` into `currentValue` (single view) or
 *     `improvedContent` (split view) as it streams in.
 *  2. On the `isGenerating: true -> false` transition, auto-commits the
 *     result (`handleBlur`) in single view, or just clears the prompt in
 *     split view — the split view's own "Apply" button is what actually
 *     commits there.
 */
export interface UseAiAssistantStreamSyncOptions {
  readonly streamedContent: string;
  readonly isGenerating: boolean;
  readonly showSplitView: boolean;
  readonly hasError: boolean;
  readonly setCurrentValue: (value: string) => void;
  readonly setImprovedContent: (value: string) => void;
  readonly handleBlur: (contentOverride: string) => void;
  readonly updateLanguageIfChanged: (content: string) => void;
  readonly clearPrompt: () => void;
}

export function useAiAssistantStreamSync(options: UseAiAssistantStreamSyncOptions): void {
  const {
    streamedContent,
    isGenerating,
    showSplitView,
    hasError,
    setCurrentValue,
    setImprovedContent,
    handleBlur,
    updateLanguageIfChanged,
    clearPrompt,
  } = options;
  const wasGeneratingRef = useRef(false);

  useEffect(() => {
    if (!streamedContent) return;
    if (showSplitView) {
      setImprovedContent(streamedContent);
    } else {
      setCurrentValue(streamedContent);
    }
  }, [streamedContent, showSplitView, setCurrentValue, setImprovedContent]);

  useEffect(() => {
    if (isGenerating) {
      wasGeneratingRef.current = true;
      return;
    }

    if (!wasGeneratingRef.current) return;

    if (!showSplitView && streamedContent) {
      wasGeneratingRef.current = false;
      updateLanguageIfChanged(streamedContent);
      // Pass streamedContent directly to avoid a stale currentValue closure.
      handleBlur(streamedContent);
      if (!hasError) clearPrompt();
      return;
    }

    if (showSplitView) {
      wasGeneratingRef.current = false;
      if (!hasError) clearPrompt();
    }
  }, [isGenerating, showSplitView, streamedContent, handleBlur, updateLanguageIfChanged, hasError, clearPrompt]);
}
