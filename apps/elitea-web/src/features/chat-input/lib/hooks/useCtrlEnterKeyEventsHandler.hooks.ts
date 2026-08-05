import type { CompositionEvent, KeyboardEvent } from 'react';
import { useCallback, useState } from 'react';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/shared/lib/hooks/
 * useCtrlEnterKeyEventsHandler.hooks.js` (unit C3, "chat-input" cluster).
 *
 * Small, generic, non-cross-feature hook with no other home yet in this
 * worktree (not owned by any Wave-2 unit's `ownedPaths`, and not part of
 * any already-landed `shared/lib/hooks/*` port) — kept local to this
 * feature slice rather than inventing a new `shared/lib/` file for its one
 * consumer (`UserInput.tsx`), per this unit's own task brief.
 */
export interface UseCtrlEnterKeyEventsHandlerParams {
  readonly onShiftEnterPressed?: (() => void) | undefined;
  readonly onCtrlEnterDown?: (() => void) | undefined;
  readonly onEnterDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /**
   * Called first, for every non-modifier key, BEFORE the Enter/Ctrl+Enter/
   * Shift+Enter dispatch below — lets a caller (e.g. slash/mention keyboard
   * navigation, wired by a future composition-root unit) intercept Enter by
   * calling `event.preventDefault()`. If it does, this hook stops there.
   */
  readonly onNormalKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
}

export interface UseCtrlEnterKeyEventsHandlerResult {
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onKeyUp: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onCompositionStart: (event: CompositionEvent<HTMLDivElement>) => void;
  readonly onCompositionEnd: (event: CompositionEvent<HTMLDivElement>) => void;
}

const IGNORED_MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

interface EnterVariantHandlers {
  readonly onCtrlEnterDown?: (() => void) | undefined;
  readonly onShiftEnterPressed?: (() => void) | undefined;
  readonly onEnterDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
}

/**
 * The Ctrl+Enter / Shift+Enter / plain-Enter dispatch, split into its own
 * module-level function purely to keep `onKeyDown` itself under the §3.5
 * cyclomatic-complexity budget (≤12).
 */
function dispatchEnterVariant(event: KeyboardEvent<HTMLDivElement>, handlers: EnterVariantHandlers, hasModifier: boolean): void {
  if (event.key !== 'Enter') return;

  if ((event.ctrlKey || event.metaKey) && handlers.onCtrlEnterDown) {
    event.preventDefault();
    handlers.onCtrlEnterDown();
    return;
  }
  if (event.shiftKey && handlers.onShiftEnterPressed) {
    event.preventDefault();
    handlers.onShiftEnterPressed();
    return;
  }
  if (!hasModifier && handlers.onEnterDown) {
    event.preventDefault();
    handlers.onEnterDown(event);
  }
}

export function useCtrlEnterKeyEventsHandler(
  params: UseCtrlEnterKeyEventsHandlerParams,
): UseCtrlEnterKeyEventsHandlerResult {
  const { onShiftEnterPressed, onCtrlEnterDown, onEnterDown, onNormalKeyDown } = params;
  const [isInComposition, setIsInComposition] = useState(false);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isInComposition) return;

      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      const isRealKey = !IGNORED_MODIFIER_KEYS.has(event.key);
      if (!hasModifier && onNormalKeyDown && isRealKey) {
        onNormalKeyDown(event);
      }

      // A normal-key handler above may already have handled this event.
      if (event.defaultPrevented) return;

      dispatchEnterVariant(event, { onCtrlEnterDown, onShiftEnterPressed, onEnterDown }, hasModifier);
    },
    [isInComposition, onCtrlEnterDown, onShiftEnterPressed, onEnterDown, onNormalKeyDown],
  );

  // Parity no-op: the baseline's own onKeyUp is an intentional empty handler.
  const onKeyUp = useCallback((_event: KeyboardEvent<HTMLDivElement>) => {
    /* no-op, matches baseline */
  }, []);

  const onCompositionStart = useCallback(() => setIsInComposition(true), []);
  const onCompositionEnd = useCallback(() => setIsInComposition(false), []);

  return { onKeyDown, onKeyUp, onCompositionStart, onCompositionEnd };
}
