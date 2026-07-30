/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useEditingCanvasNavBlocker.js` —
 * prevents navigation away from the canvas editor when there are unsaved
 * edits.
 *
 * Port of `apps/elitea-ui/src/hooks/chat/useEditingCanvasNavBlocker.js`.
 */
import { useEffect } from 'react';

/** @public Params for `useEditingCanvasNavBlocker`. */
export interface UseEditingCanvasNavBlockerParams {
  /** Whether the canvas has unsaved changes. */
  readonly hasUnsavedChanges: boolean;
  /** Custom confirmation message (defaults to generic). */
  readonly message?: string;
}

/**
 * `useEditingCanvasNavBlocker` — prevents navigation away from the
 * canvas editor when there are unsaved edits. Uses the navigation API
 * and the beforeunload event for browser-level protection.
 */
export function useEditingCanvasNavBlocker({
  hasUnsavedChanges,
  message = 'You have unsaved changes. Are you sure you want to leave?',
}: UseEditingCanvasNavBlockerParams): void {
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges, message]);
}
