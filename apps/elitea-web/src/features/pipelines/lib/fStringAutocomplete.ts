/**
 * Pure helpers behind the pipeline YAML f-string (`{variable}`) autocomplete
 * popper. Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * fstring-autocomplete/lib/helpers/fStringAutocomplete.helpers.js`
 * (baseline, 107 lines) — logic is unchanged, only typed.
 */

/** One selectable f-string variable. */
export interface FStringAutocompleteOption {
  readonly value: string;
  readonly label: string;
}

/** The autocomplete popper's derived state: whether it is open, and — while open — the `{`/`}` span being edited. */
export interface FStringAutocompleteState {
  readonly activeIndex: number;
  readonly hasClosingBrace: boolean;
  readonly isOpen: boolean;
  readonly query: string;
  readonly replaceEnd: number;
  readonly replaceStart: number;
}

/** Result of committing a selected variable into the input's text. */
export interface FStringAutocompleteInsertion {
  readonly changeFrom: number;
  readonly changeTo: number;
  readonly cursorPosition: number;
  readonly insertText: string;
  readonly nextValue: string;
}

const CLOSED_FSTRING_AUTOCOMPLETE_STATE: FStringAutocompleteState = {
  activeIndex: 0,
  hasClosingBrace: false,
  isOpen: false,
  query: '',
  replaceEnd: 0,
  replaceStart: 0,
};

const FSTRING_VARIABLE_PATTERN = /^[A-Za-z0-9_]*$/;

export function createClosedFStringAutocompleteState(): FStringAutocompleteState {
  return { ...CLOSED_FSTRING_AUTOCOMPLETE_STATE };
}

/**
 * Derives the autocomplete state from the input's current text and cursor
 * position: open when the cursor sits inside an unterminated (or
 * still-being-typed) `{...}` span whose contents so far look like a valid
 * variable-name prefix; closed otherwise.
 */
export function getFStringAutocompleteState(
  inputValue = '',
  cursorPosition = 0,
): FStringAutocompleteState {
  const safeCursorPosition = typeof cursorPosition === 'number' ? cursorPosition : inputValue.length;
  const valueBeforeCursor = inputValue.slice(0, safeCursorPosition);
  const openBraceIndex = valueBeforeCursor.lastIndexOf('{');

  if (openBraceIndex === -1) {
    return createClosedFStringAutocompleteState();
  }

  const closeBraceBeforeCursor = valueBeforeCursor.lastIndexOf('}');

  if (closeBraceBeforeCursor > openBraceIndex) {
    return createClosedFStringAutocompleteState();
  }

  const query = inputValue.slice(openBraceIndex + 1, safeCursorPosition);

  if (!FSTRING_VARIABLE_PATTERN.test(query)) {
    return createClosedFStringAutocompleteState();
  }

  const nextOpenBraceIndex = inputValue.indexOf('{', openBraceIndex + 1);
  const nextCloseBraceIndex = inputValue.indexOf('}', safeCursorPosition);
  const hasClosingBrace =
    nextCloseBraceIndex !== -1 && (nextOpenBraceIndex === -1 || nextCloseBraceIndex < nextOpenBraceIndex);

  return {
    activeIndex: 0,
    hasClosingBrace,
    isOpen: true,
    query,
    replaceEnd: hasClosingBrace ? nextCloseBraceIndex : safeCursorPosition,
    replaceStart: openBraceIndex + 1,
  };
}

/** Options whose `value` (falling back to `label`) starts with `query`, case-insensitively. Empty query matches everything. */
export function filterFStringAutocompleteOptions(
  options: readonly FStringAutocompleteOption[] = [],
  query = '',
): FStringAutocompleteOption[] {
  const normalizedQuery = query.toLowerCase();

  return options.filter((option) => {
    const optionValue = String(option.value || option.label || '').toLowerCase();

    return normalizedQuery ? optionValue.startsWith(normalizedQuery) : true;
  });
}

export function getNextAutocompleteIndex(
  currentIndex: number,
  optionsLength: number,
  direction: 'ArrowDown' | 'ArrowUp',
): number {
  if (direction === 'ArrowDown') {
    return currentIndex >= optionsLength - 1 ? 0 : currentIndex + 1;
  }

  return currentIndex <= 0 ? optionsLength - 1 : currentIndex - 1;
}

export function getFStringAutocompleteHighlightedIndex(
  activeIndex = 0,
  options: readonly unknown[] = [],
): number {
  return options.length ? Math.min(activeIndex, options.length - 1) : -1;
}

/** Builds the next input value + caret position from replacing the in-progress `{query` span with the selected variable. */
export function getFStringAutocompleteInsertion(
  inputValue: string,
  autocompleteState: FStringAutocompleteState,
  selectedVariable: string,
): FStringAutocompleteInsertion {
  const { hasClosingBrace, replaceEnd, replaceStart } = autocompleteState;
  const insertText = hasClosingBrace ? selectedVariable : `${selectedVariable}}`;
  const nextValue = `${inputValue.slice(0, replaceStart)}${insertText}${inputValue.slice(replaceEnd)}`;

  return {
    changeFrom: replaceStart,
    changeTo: replaceEnd,
    cursorPosition: replaceStart + selectedVariable.length + 1,
    insertText,
    nextValue,
  };
}

/**
 * Structural match for `@popperjs/core`'s `VirtualElement` — the shape MUI's
 * `Popper`/`PopperProps['anchorEl']` accepts besides a real `Element`.
 * Declared locally instead of importing the type from `@popperjs/core`
 * (an undeclared transitive dependency of `@mui/material`, not a direct
 * `package.json` dependency of this app).
 */
export interface FStringAutocompleteVirtualAnchor {
  readonly getBoundingClientRect: () => DOMRect;
  readonly contextElement?: Element;
}

/** A caret's viewport `{top, left}`, as reported by the consuming input/textarea. */
export interface FStringAutocompleteAnchorPosition {
  readonly top: number;
  readonly left: number;
}

/**
 * Wraps a caret position as a zero-size Popper `VirtualElement`, so the
 * autocomplete popper anchors at the text caret rather than at the input
 * element's own bounding box.
 */
export function createVirtualAnchorElement(
  anchorPosition: FStringAutocompleteAnchorPosition | null | undefined,
): FStringAutocompleteVirtualAnchor | null {
  if (!anchorPosition) {
    return null;
  }

  return {
    // Structurally a `DOMRect` already (every required field present) —
    // `FStringAutocompleteVirtualAnchor['getBoundingClientRect']`'s own
    // `() => DOMRect` return-type annotation contextually types this object
    // literal, so no cast is needed (one was flagged as unnecessary by
    // tsgolint's type-aware pass and removed).
    getBoundingClientRect: () => ({
      width: 0,
      height: 0,
      top: anchorPosition.top,
      left: anchorPosition.left,
      right: anchorPosition.left,
      bottom: anchorPosition.top,
      x: anchorPosition.left,
      y: anchorPosition.top,
      toJSON: () => ({}),
    }),
  };
}
