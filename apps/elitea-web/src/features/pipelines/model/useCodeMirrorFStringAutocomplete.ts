import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

import { createVirtualAnchorElement, getFStringAutocompleteInsertion } from '../lib/fStringAutocomplete';
import type { FStringAutocompleteOption } from '../lib/fStringAutocomplete';
import { useFStringAutocomplete } from './useFStringAutocomplete';
import type { UseFStringAutocompleteResult } from './useFStringAutocomplete';
import type { FStringAutocompletePopperProps } from '../ui/FStringAutocompletePopper';

/**
 * Bridges A2b's generic f-string autocomplete logic (`./useFStringAutocomplete`,
 * `../lib/fStringAutocomplete`) with a CodeMirror 6 editor view. Ported from
 * `apps/elitea-ui/src/[fsd]/features/pipelines/ai-assistant/lib/hooks/
 * useCodeMirrorFStringAutocomplete.hooks.js` (baseline, 242 lines) — unit
 * A2a.
 *
 * DEVIATION FROM BASELINE (how the `EditorView` is obtained): the baseline
 * takes an `editorRef` prop and reads `editorRef.current?.view` off a
 * `forwardRef`-exposed imperative handle from the baseline's own
 * `Field.CodeMirrorEditor`. This app's ported `shared/ui/CodeMirrorEditor`
 * (unit S1-E) is a plain function component with NO imperative ref API —
 * its own doc comment records this as a deliberate scope trim ("neither
 * in-scope caller ever attaches a ref to it"), and `shared/ui` is out of
 * this sub-unit's ownership fence to extend. `shared/ui/CodeMirrorEditor`
 * DOES accept an `extensions: Extension[]` prop, and CodeMirror 6's own
 * `EditorView.updateListener` extension receives the live `EditorView`
 * directly in its callback closure (`update.view`) — no ref needed at all.
 * This hook therefore captures the view itself, in the SAME tracking
 * extension it already registers for autocomplete-state tracking, into an
 * internal ref (`viewRef`), and uses that for both `view.dispatch(...)`
 * (variable insertion) and `view.coordsAtPos(...)` (popper anchor
 * positioning) — achieving the exact same capability as the baseline's
 * `editorRef.current.view` without requiring any ref API from a slice this
 * sub-unit cannot modify. `viewRef` is populated by the first `ViewUpdate`
 * CodeMirror fires after mount (verified: `@uiw/react-codemirror`'s
 * `useCodeMirror` creates the `EditorView` synchronously with the extension
 * array already attached, so the first keystroke/focus/doc-change that can
 * possibly open the autocomplete popper has already fired at least one
 * `ViewUpdate` through this listener beforehand).
 */

const handleAutocompleteKey = (
  contextRef: { current: AutocompleteKeyContext | null },
  key: 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Escape',
): boolean => {
  const ctx = contextRef.current;

  if (!ctx || !ctx.autocompleteState.isOpen) {
    return false;
  }

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (ctx.filteredStateVariableOptions.length === 0) {
      return false;
    }

    ctx.setActiveIndex(nextAutocompleteIndex(ctx.highlightedOptionIndex, ctx.filteredStateVariableOptions.length, key));
    return true;
  }

  if (key === 'Enter') {
    const selectedOption = ctx.filteredStateVariableOptions[ctx.highlightedOptionIndex];
    if (!selectedOption) return false;
    ctx.handleSuggestionSelect(selectedOption.value);
    return true;
  }

  if (key === 'Escape') {
    ctx.closeAutocomplete();
    return true;
  }

  return false;
};

function nextAutocompleteIndex(currentIndex: number, optionsLength: number, direction: 'ArrowDown' | 'ArrowUp'): number {
  if (direction === 'ArrowDown') {
    return currentIndex >= optionsLength - 1 ? 0 : currentIndex + 1;
  }
  return currentIndex <= 0 ? optionsLength - 1 : currentIndex - 1;
}

interface AutocompleteKeyContext {
  readonly autocompleteState: UseFStringAutocompleteResult['autocompleteState'];
  readonly filteredStateVariableOptions: FStringAutocompleteOption[];
  readonly highlightedOptionIndex: number;
  readonly handleSuggestionSelect: (value: string) => void;
  readonly closeAutocomplete: () => void;
  readonly setActiveIndex: (index: number) => void;
}

export interface UseCodeMirrorFStringAutocompleteOptions {
  readonly extensions?: Extension | Extension[] | undefined;
  readonly notifyChange?: ((value: string) => void) | undefined;
  readonly enableFStringAutocomplete?: boolean;
  readonly readOnly?: boolean;
  readonly stateVariableOptions?: readonly FStringAutocompleteOption[];
}

export interface UseCodeMirrorFStringAutocompleteResult {
  readonly mergedExtensions: Extension[];
  readonly popperProps: FStringAutocompletePopperProps;
}

export function useCodeMirrorFStringAutocomplete(
  options: UseCodeMirrorFStringAutocompleteOptions,
): UseCodeMirrorFStringAutocompleteResult {
  const { extensions, notifyChange, enableFStringAutocomplete = false, readOnly = false, stateVariableOptions = [] } = options;

  const viewRef = useRef<EditorView | null>(null);
  const updateAutocompleteFromViewRef = useRef<((view: EditorView) => void) | null>(null);
  const autocompleteKeyContextRef = useRef<AutocompleteKeyContext | null>(null);

  const [autocompleteAnchor, setAutocompleteAnchor] = useState<{ left: number; top: number } | null>(null);

  const handleSuggestionSelectFromView = useCallback(
    (selectedVariable: string, currentAutocompleteState: UseFStringAutocompleteResult['autocompleteState']) => {
      const view = viewRef.current;
      if (!view || !currentAutocompleteState.isOpen) return;

      const currentEditorValue = view.state.doc.toString();
      const { changeFrom, changeTo, cursorPosition, insertText, nextValue } = getFStringAutocompleteInsertion(
        currentEditorValue,
        currentAutocompleteState,
        selectedVariable,
      );

      view.dispatch({
        changes: { from: changeFrom, to: changeTo, insert: insertText },
        selection: { anchor: cursorPosition },
        scrollIntoView: true,
      });
      notifyChange?.(nextValue);
      view.focus();
    },
    [notifyChange],
  );

  const {
    autocompleteState,
    closeAutocomplete: closeAutocompleteState,
    filteredOptions: filteredStateVariableOptions,
    highlightedOptionIndex,
    setActiveIndex,
    updateAutocompleteState,
  } = useFStringAutocomplete({
    enabled: enableFStringAutocomplete && !readOnly,
    options: stateVariableOptions,
    onSelect: handleSuggestionSelectFromView,
  });

  const closeAutocomplete = useCallback(() => {
    closeAutocompleteState();
    setAutocompleteAnchor(null);
  }, [closeAutocompleteState]);

  const updateAutocompleteFromView = useCallback(
    (view: EditorView) => {
      if (!enableFStringAutocomplete || readOnly || !stateVariableOptions.length || !view.hasFocus) {
        closeAutocomplete();
        return;
      }

      const currentValue = view.state.doc.toString();
      const cursorPosition = view.state.selection.main.head;
      const nextAutocompleteState = updateAutocompleteState(currentValue, cursorPosition);

      if (!nextAutocompleteState.isOpen) {
        setAutocompleteAnchor(null);
        return;
      }

      const cursorCoordinates = view.coordsAtPos(cursorPosition);
      setAutocompleteAnchor(cursorCoordinates ? { left: cursorCoordinates.left, top: cursorCoordinates.bottom } : null);
    },
    [closeAutocomplete, enableFStringAutocomplete, readOnly, stateVariableOptions.length, updateAutocompleteState],
  );

  const handleSuggestionSelect = useCallback(
    (selectedVariable: string) => {
      handleSuggestionSelectFromView(selectedVariable, autocompleteState);
      closeAutocomplete();
    },
    [autocompleteState, closeAutocomplete, handleSuggestionSelectFromView],
  );

  const isAutocompleteActive = useMemo(
    () => enableFStringAutocomplete && !readOnly && stateVariableOptions.length > 0,
    [enableFStringAutocomplete, readOnly, stateVariableOptions.length],
  );

  const trackingExtension = useMemo(() => {
    if (!isAutocompleteActive) return null;

    return EditorView.updateListener.of((update) => {
      viewRef.current = update.view;
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        updateAutocompleteFromViewRef.current?.(update.view);
      }
    });
  }, [isAutocompleteActive]);

  const autocompleteKeymap = useMemo(() => {
    if (!isAutocompleteActive) return null;

    return Prec.highest(
      keymap.of([
        { key: 'ArrowDown', run: () => handleAutocompleteKey(autocompleteKeyContextRef, 'ArrowDown') },
        { key: 'ArrowUp', run: () => handleAutocompleteKey(autocompleteKeyContextRef, 'ArrowUp') },
        { key: 'Enter', run: () => handleAutocompleteKey(autocompleteKeyContextRef, 'Enter') },
        { key: 'Escape', run: () => handleAutocompleteKey(autocompleteKeyContextRef, 'Escape') },
      ]),
    );
  }, [isAutocompleteActive]);

  const mergedExtensions = useMemo((): Extension[] => {
    const normalizedExtensions: Extension[] = Array.isArray(extensions) ? extensions : extensions ? [extensions] : [];
    const extras = [trackingExtension, autocompleteKeymap].filter((extension): extension is Extension => extension !== null);
    return extras.length ? [...normalizedExtensions, ...extras] : normalizedExtensions;
  }, [extensions, trackingExtension, autocompleteKeymap]);

  const virtualAnchor = useMemo(() => createVirtualAnchorElement(autocompleteAnchor), [autocompleteAnchor]);

  useEffect(() => {
    updateAutocompleteFromViewRef.current = updateAutocompleteFromView;
  }, [updateAutocompleteFromView]);

  // Keep ref up to date on every render so the keymap closure always uses latest values.
  autocompleteKeyContextRef.current = {
    autocompleteState,
    filteredStateVariableOptions,
    highlightedOptionIndex,
    handleSuggestionSelect,
    closeAutocomplete,
    setActiveIndex,
  };

  const popperProps: FStringAutocompletePopperProps = useMemo(
    () => ({
      open: autocompleteState.isOpen && filteredStateVariableOptions.length > 0 && Boolean(virtualAnchor),
      anchorEl: virtualAnchor,
      options: filteredStateVariableOptions,
      highlightedIndex: highlightedOptionIndex,
      onSelect: handleSuggestionSelect,
    }),
    [autocompleteState.isOpen, filteredStateVariableOptions, highlightedOptionIndex, virtualAnchor, handleSuggestionSelect],
  );

  return { mergedExtensions, popperProps };
}
