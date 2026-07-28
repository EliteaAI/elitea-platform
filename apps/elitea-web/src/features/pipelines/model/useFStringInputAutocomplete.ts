import { type RefObject, useCallback, useEffect, useRef } from 'react';

import {
  createClosedFStringAutocompleteState,
  getFStringAutocompleteInsertion,
  type FStringAutocompleteOption,
  type FStringAutocompleteState,
} from '../lib/fStringAutocomplete';
import { useFStringAutocomplete, type UseFStringAutocompleteResult } from './useFStringAutocomplete';

/**
 * Minimal structural shape of a "text changed" event: real DOM/React change
 * events (`ChangeEvent<HTMLInputElement>`, `ChangeEvent<HTMLTextAreaElement>`)
 * satisfy this, and so does the synthetic event this hook itself synthesises
 * when committing a selected suggestion (see `handleSuggestionSelect` below —
 * same shape the baseline's own `{ preventDefault: () => {}, target: {
 * value } }` literal used).
 *
 * Not exported: nothing outside this module names it explicitly yet (a
 * future consumer's own `onInput` handler is checked against
 * `UseFStringInputAutocompleteOptions['onInput']`'s parameter structurally,
 * with no need to import this type by name — confirmed against this
 * module's own test file, which passes plain object literals). Add `export`
 * back the moment a real caller needs to name it.
 */
interface FStringInputChangeEventLike {
  preventDefault: () => void;
  readonly target: {
    readonly value: string;
    readonly selectionStart?: number | null;
  };
}

/** Structural shape of a cursor-position-only event (click/keyup on the input) — `target` may be absent or not yet carry a `value`. Not exported: see `FStringInputChangeEventLike`'s identical note. */
interface FStringCursorEventLike {
  readonly target?: {
    readonly value?: string;
    readonly selectionStart?: number | null;
  };
}

export interface UseFStringInputAutocompleteOptions {
  /** The input/textarea's current, fully-resolved text value. */
  readonly resolvedValue: string;
  /** Called with every text change — both real edits and suggestion-commit insertions. */
  readonly onInput: (event: FStringInputChangeEventLike) => void;
  // `| undefined`: see `UseFStringAutocompleteOptions`'s identical note —
  // a future caller forwarding its own already-optional prop needs this.
  readonly enabled?: boolean | undefined;
  readonly options?: readonly FStringAutocompleteOption[] | undefined;
}

export interface UseFStringInputAutocompleteResult {
  readonly autocompleteState: FStringAutocompleteState;
  readonly closeAutocomplete: () => void;
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly filteredOptions: FStringAutocompleteOption[];
  readonly handleAutocompleteKeyDown: UseFStringAutocompleteResult['handleAutocompleteKeyDown'];
  readonly handleChange: (event: FStringInputChangeEventLike) => void;
  readonly handleCursorChange: (event: FStringCursorEventLike) => void;
  readonly handleSuggestionSelect: (selectedVariable: string, currentAutocompleteState?: FStringAutocompleteState) => void;
  readonly highlightedOptionIndex: number;
  readonly inputRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>;
}

/**
 * Wires `useFStringAutocomplete`'s state machine to a concrete text
 * input/textarea: tracks change + cursor-move events, commits a selected
 * suggestion by splicing it into the text and re-focusing the input at the
 * new caret position. Ported from `apps/elitea-ui/src/[fsd]/features/
 * pipelines/fstring-autocomplete/lib/hooks/
 * useFStringInputAutocomplete.hooks.js` (baseline, 97 lines) — logic
 * unchanged, only typed.
 */
export function useFStringInputAutocomplete(
  props: UseFStringInputAutocompleteOptions,
): UseFStringInputAutocompleteResult {
  const { resolvedValue, onInput, enabled, options } = props;

  const containerRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<(HTMLInputElement & HTMLTextAreaElement) | null>(null);
  const pendingCursorPositionRef = useRef<number | null>(null);
  // Reassigned unconditionally on every render, right after
  // `useFStringAutocomplete` below runs — this initial value is only ever
  // observed if `handleSuggestionSelect` somehow fired before this
  // component's first render committed, which cannot happen (it is only
  // reachable from a keyboard/click event on already-mounted UI). Seeded
  // with the closed state (matching `useFStringAutocomplete`'s own initial
  // state) purely so the ref's type is `FStringAutocompleteState`, not
  // `FStringAutocompleteState | null` — the baseline's untyped
  // `useRef(null)` had no such distinction to preserve.
  const autocompleteStateRef = useRef<FStringAutocompleteState>(createClosedFStringAutocompleteState());

  const handleSuggestionSelect = useCallback(
    (selectedVariable: string, currentAutocompleteState?: FStringAutocompleteState) => {
      const { cursorPosition, nextValue } = getFStringAutocompleteInsertion(
        resolvedValue,
        currentAutocompleteState ?? autocompleteStateRef.current,
        selectedVariable,
      );

      pendingCursorPositionRef.current = cursorPosition;
      onInput({
        preventDefault: () => {},
        target: {
          value: nextValue,
        },
      });
    },
    [onInput, resolvedValue],
  );

  const {
    autocompleteState,
    closeAutocomplete,
    filteredOptions,
    handleAutocompleteKeyDown,
    highlightedOptionIndex,
    updateAutocompleteState,
  } = useFStringAutocomplete({
    enabled,
    options,
    onSelect: handleSuggestionSelect,
  });

  autocompleteStateRef.current = autocompleteState;

  const handleChange = useCallback(
    (event: FStringInputChangeEventLike) => {
      onInput(event);
      updateAutocompleteState(event.target.value, event.target.selectionStart ?? event.target.value.length);
    },
    [onInput, updateAutocompleteState],
  );

  const handleCursorChange = useCallback(
    (event: FStringCursorEventLike) => {
      const value = event.target?.value;

      if (value === undefined) {
        return;
      }

      updateAutocompleteState(value, event.target?.selectionStart ?? value.length, {
        preserveActiveIndex: true,
      });
    },
    [updateAutocompleteState],
  );

  useEffect(() => {
    if (pendingCursorPositionRef.current === null) {
      return undefined;
    }

    const cursorPosition = pendingCursorPositionRef.current;
    const animationFrameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange?.(cursorPosition, cursorPosition);
      pendingCursorPositionRef.current = null;
      updateAutocompleteState(resolvedValue, cursorPosition);
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [resolvedValue, updateAutocompleteState]);

  return {
    autocompleteState,
    closeAutocomplete,
    containerRef,
    filteredOptions,
    handleAutocompleteKeyDown,
    handleChange,
    handleCursorChange,
    handleSuggestionSelect,
    highlightedOptionIndex,
    inputRef,
  };
}
