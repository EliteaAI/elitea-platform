/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useEditingCanvasNavBlocker.js` —
 * the baseline hook's whole job is `setEditingCanvasBlockNav(isEditingCanvas)`,
 * mirroring whether the canvas editor is open into the app-wide nav-blocker
 * state (old app: Redux `state.settings.navBlocker.isEditingCanvas`). This
 * app's equivalent flag lives in `shared/lib/editorState.ts`'s
 * `useEditorStateStore().setEditingCanvas` — the same store
 * `processes/chat/model/useEditorMutex.ts` already reads `isEditingCanvas`
 * from.
 *
 * The two-effect mount/unmount shape (sync on every value change, reset only
 * on unmount) mirrors `processes/chat/model/useStreamingNavBlocker.ts`'s
 * established pattern for the sibling "streaming" nav-blocker flag.
 *
 * Also retains this port's own `beforeunload` guard (browser-tab-close
 * protection), driven by `hasUnsavedChanges` — the baseline's `isEditingCanvas`
 * flag itself never gated `beforeunload` (that was `NavBlockerDialog`'s job,
 * off `isBlockNav`/`isStreaming`); keeping this hook's existing
 * `hasUnsavedChanges`-driven guard is an established, disclosed super-set,
 * not a regression.
 */
import { useEffect } from 'react';

import { useEditorStateStore } from '@/shared/lib/editorState';

/** @public Params for `useEditingCanvasNavBlocker`. */
export interface UseEditingCanvasNavBlockerParams {
  /** Whether the canvas editor is currently open — mirrored into `useEditorStateStore().isEditingCanvas`. */
  readonly isEditingCanvas: boolean;
  /** Whether the canvas has unsaved changes — gates the `beforeunload` browser-tab-close guard. Defaults to `isEditingCanvas`. */
  readonly hasUnsavedChanges?: boolean;
  /** Custom confirmation message (defaults to generic). */
  readonly message?: string;
}

/**
 * `useEditingCanvasNavBlocker` — mirrors whether the canvas editor is open
 * into the app-wide editor-state store (so in-app navigation can be blocked
 * while any editor is open) and guards the browser's `beforeunload` prompt
 * while there are unsaved edits.
 */
export function useEditingCanvasNavBlocker({
  isEditingCanvas,
  hasUnsavedChanges = isEditingCanvas,
  message = 'You have unsaved changes. Are you sure you want to leave?',
}: UseEditingCanvasNavBlockerParams): void {
  const setEditingCanvas = useEditorStateStore((s) => s.setEditingCanvas);

  useEffect(() => {
    setEditingCanvas(isEditingCanvas);
  }, [setEditingCanvas, isEditingCanvas]);

  useEffect(() => {
    return () => setEditingCanvas(false);
    // oxlint-disable-next-line react/exhaustive-deps -- intentionally only re-runs on unmount (baseline parity: the cleanup fires once, on unmount, not on every `isEditingCanvas` change).
  }, [setEditingCanvas]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges, message]);
}
