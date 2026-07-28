import { useCallback, useState } from 'react';

/**
 * Exact port of `apps/elitea-ui/src/[fsd]/shared/lib/hooks/useFieldFocus.hooks.js`
 * (4 lines of state + 2 callbacks, no baseline behaviour dropped).
 *
 * Not promoted anywhere (it isn't one of the 4 "not promoted, duplicate
 * locally" hooks named in the Wave-2 brief, nor part of the
 * `entities/application-form`/`entities/toolkit` promotion) — a plain,
 * dependency-free React hook, duplicated locally per this sub-unit's
 * `ApplicationEditForm` need for it (tracks which of the Name/Description
 * fields currently has focus, to show the "N characters left" hint only for
 * the focused field).
 */
export function useFieldFocus(initialState: string | null = null): {
  readonly focusedField: string | null;
  readonly toggleFieldFocus: (field?: string | null) => void;
  readonly isFocused: (field: string) => boolean;
} {
  const [focusedField, setFocusedField] = useState<string | null>(initialState);

  const toggleFieldFocus = useCallback((field: string | null = null) => {
    setFocusedField(field);
  }, []);

  const isFocused = useCallback((field: string) => field === focusedField, [focusedField]);

  return { focusedField, toggleFieldFocus, isFocused };
}
