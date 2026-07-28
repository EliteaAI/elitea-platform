import { useCallback, useMemo, useState } from 'react';

import {
  createClosedFStringAutocompleteState,
  filterFStringAutocompleteOptions,
  getFStringAutocompleteHighlightedIndex,
  getFStringAutocompleteState,
  getNextAutocompleteIndex,
  type FStringAutocompleteOption,
  type FStringAutocompleteState,
} from '../lib/fStringAutocomplete';

/**
 * Minimal structural shape `handleAutocompleteKeyDown` needs from a keyboard
 * event — only `.key` and `.preventDefault()` are ever read. A real React
 * `KeyboardEvent<HTMLInputElement>` (or `<HTMLTextAreaElement>`) satisfies
 * this structurally, so callers do not need a cast; this hook stays
 * decoupled from which element type it is ultimately wired to (the baseline
 * imposed no such constraint either).
 *
 * Not exported: nothing outside this module names it explicitly yet — a
 * caller's own `onKeyDown` handler is checked against
 * `UseFStringAutocompleteResult['handleAutocompleteKeyDown']`'s parameter
 * structurally. Add `export` back the moment a real caller needs to name it.
 */
interface FStringKeyboardEventLike {
  readonly key: string;
  preventDefault: () => void;
}

// `| undefined` on every optional field, not just `?`: under
// `exactOptionalPropertyTypes`, `useFStringInputAutocomplete` forwards its
// OWN already-optional `enabled`/`options` props straight through to this
// hook — destructuring an optional prop yields a `T | undefined`-typed
// local even where the source declared it `T?`, so a plain `enabled?:
// boolean` target here would reject that forwarded value. Same fix
// `CodeMirrorEditorProps.readOnly`/`ResizableCodeMirrorEditorProps.readOnly`
// (unit S1-E) already established for this exact class of pass-through.
export interface UseFStringAutocompleteOptions {
  readonly enabled?: boolean | undefined;
  readonly options?: readonly FStringAutocompleteOption[] | undefined;
  readonly onSelect?: ((value: string, state: FStringAutocompleteState) => void) | undefined;
}

export interface UseFStringAutocompleteResult {
  readonly autocompleteState: FStringAutocompleteState;
  readonly closeAutocomplete: () => void;
  readonly filteredOptions: FStringAutocompleteOption[];
  readonly handleAutocompleteKeyDown: (event: FStringKeyboardEventLike) => boolean;
  readonly highlightedOptionIndex: number;
  readonly setActiveIndex: (nextIndex: number) => void;
  readonly updateAutocompleteState: (
    inputValue: string,
    cursorPosition: number,
    updateOptions?: { readonly preserveActiveIndex?: boolean },
  ) => FStringAutocompleteState;
}

/**
 * Owns the popper's open/closed/query/highlighted-index state and keyboard
 * navigation (Escape/ArrowUp/ArrowDown/Enter) for the pipeline YAML f-string
 * (`{variable}`) autocomplete. Ported from `apps/elitea-ui/src/[fsd]/
 * features/pipelines/fstring-autocomplete/lib/hooks/
 * useFStringAutocomplete.hooks.js` (baseline, 137 lines) — logic unchanged,
 * only typed and pointed at this app's own `lib/fStringAutocomplete`.
 */
export function useFStringAutocomplete(
  props: UseFStringAutocompleteOptions,
): UseFStringAutocompleteResult {
  const { enabled = false, options = [], onSelect } = props;

  const [autocompleteState, setAutocompleteState] = useState<FStringAutocompleteState>(
    createClosedFStringAutocompleteState,
  );

  const filteredOptions = useMemo(() => {
    if (!enabled || !autocompleteState.isOpen || !options.length) {
      return [];
    }

    return filterFStringAutocompleteOptions(options, autocompleteState.query);
  }, [autocompleteState.isOpen, autocompleteState.query, enabled, options]);

  const highlightedOptionIndex = useMemo(
    () => getFStringAutocompleteHighlightedIndex(autocompleteState.activeIndex, filteredOptions),
    [autocompleteState.activeIndex, filteredOptions],
  );

  const closeAutocomplete = useCallback(() => {
    setAutocompleteState(createClosedFStringAutocompleteState());
  }, []);

  const updateAutocompleteState = useCallback(
    (
      inputValue: string,
      cursorPosition: number,
      updateOptions?: { readonly preserveActiveIndex?: boolean },
    ): FStringAutocompleteState => {
      const preserveActiveIndex = updateOptions?.preserveActiveIndex ?? false;

      if (!enabled || !options.length) {
        const closedState = createClosedFStringAutocompleteState();

        setAutocompleteState(closedState);

        return closedState;
      }

      const nextState = getFStringAutocompleteState(inputValue, cursorPosition);

      if (preserveActiveIndex) {
        setAutocompleteState((prevState) => {
          if (nextState.isOpen && prevState.isOpen && nextState.query === prevState.query) {
            return { ...nextState, activeIndex: prevState.activeIndex };
          }

          return nextState;
        });
      } else {
        setAutocompleteState(nextState);
      }

      return nextState;
    },
    [enabled, options.length],
  );

  const handleAutocompleteKeyDown = useCallback(
    (event: FStringKeyboardEventLike): boolean => {
      if (event.key === 'Escape' && autocompleteState.isOpen) {
        event.preventDefault();
        closeAutocomplete();

        return true;
      }

      if (!autocompleteState.isOpen || filteredOptions.length === 0) {
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setAutocompleteState((prevState) => ({
          ...prevState,
          activeIndex: getNextAutocompleteIndex(prevState.activeIndex, filteredOptions.length, 'ArrowDown'),
        }));

        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setAutocompleteState((prevState) => ({
          ...prevState,
          activeIndex: getNextAutocompleteIndex(prevState.activeIndex, filteredOptions.length, 'ArrowUp'),
        }));

        return true;
      }

      if (event.key === 'Enter') {
        const selectedOption = filteredOptions[highlightedOptionIndex];

        if (!selectedOption) {
          return false;
        }

        event.preventDefault();
        onSelect?.(selectedOption.value, autocompleteState);
        closeAutocomplete();

        return true;
      }

      return false;
    },
    [autocompleteState, closeAutocomplete, filteredOptions, highlightedOptionIndex, onSelect],
  );

  const setActiveIndex = useCallback((nextIndex: number) => {
    setAutocompleteState((prevState) => ({
      ...prevState,
      activeIndex: nextIndex,
    }));
  }, []);

  return {
    autocompleteState,
    closeAutocomplete,
    filteredOptions,
    handleAutocompleteKeyDown,
    highlightedOptionIndex,
    setActiveIndex,
    updateAutocompleteState,
  };
}
