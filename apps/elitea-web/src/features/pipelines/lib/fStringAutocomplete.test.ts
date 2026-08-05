import { describe, expect, it } from 'vitest';

import {
  createClosedFStringAutocompleteState,
  createVirtualAnchorElement,
  filterFStringAutocompleteOptions,
  getFStringAutocompleteHighlightedIndex,
  getFStringAutocompleteInsertion,
  getFStringAutocompleteState,
  getNextAutocompleteIndex,
} from './fStringAutocomplete';

describe('createClosedFStringAutocompleteState', () => {
  it('returns a fresh closed state object every call', () => {
    const a = createClosedFStringAutocompleteState();
    const b = createClosedFStringAutocompleteState();
    expect(a).toEqual({
      activeIndex: 0,
      hasClosingBrace: false,
      isOpen: false,
      query: '',
      replaceEnd: 0,
      replaceStart: 0,
    });
    expect(a).not.toBe(b);
  });
});

describe('getFStringAutocompleteState', () => {
  it('is closed when there is no open brace before the cursor', () => {
    expect(getFStringAutocompleteState('hello world', 5).isOpen).toBe(false);
  });

  it('opens on an unterminated `{` with a valid partial variable name', () => {
    const state = getFStringAutocompleteState('prefix {ab', 10);
    expect(state).toEqual({
      activeIndex: 0,
      hasClosingBrace: false,
      isOpen: true,
      query: 'ab',
      replaceEnd: 10,
      replaceStart: 8,
    });
  });

  it('closes once a `}` has already closed the most recent `{` before the cursor', () => {
    expect(getFStringAutocompleteState('{done} rest', 9).isOpen).toBe(false);
  });

  it('closes when the in-progress query contains a non-variable character', () => {
    expect(getFStringAutocompleteState('{a-b', 4).isOpen).toBe(false);
  });

  it('detects an existing closing brace ahead of the cursor and reports its position as replaceEnd', () => {
    const state = getFStringAutocompleteState('{ab}', 3);
    expect(state.hasClosingBrace).toBe(true);
    expect(state.replaceEnd).toBe(3);
  });

  it('does not treat a closing brace belonging to a later `{...}` span as this span\'s close', () => {
    // Cursor sits right after "ab" inside the first, still-unterminated
    // `{ab`; the only `}` in the string belongs to a second, later `{cd}`
    // span — so hasClosingBrace must stay false, not borrow that brace.
    const state = getFStringAutocompleteState('{ab {cd}', 3);
    expect(state.isOpen).toBe(true);
    expect(state.hasClosingBrace).toBe(false);
    expect(state.replaceEnd).toBe(3);
  });

  it('defaults cursorPosition to the input length when given a non-number', () => {
    // @ts-expect-error -- exercising the runtime fallback for a non-number argument
    const state = getFStringAutocompleteState('{ab', 'not-a-number');
    expect(state.query).toBe('ab');
  });
});

describe('filterFStringAutocompleteOptions', () => {
  const options = [
    { value: 'alpha', label: 'Alpha' },
    { value: 'apple', label: 'Apple' },
    { value: 'beta', label: 'Beta' },
  ];

  it('returns every option for an empty query', () => {
    expect(filterFStringAutocompleteOptions(options, '')).toHaveLength(3);
  });

  it('filters case-insensitively by value prefix', () => {
    expect(filterFStringAutocompleteOptions(options, 'AL')).toEqual([{ value: 'alpha', label: 'Alpha' }]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterFStringAutocompleteOptions(options, 'zzz')).toEqual([]);
  });
});

describe('getNextAutocompleteIndex', () => {
  it('advances forward and wraps at the end on ArrowDown', () => {
    expect(getNextAutocompleteIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(getNextAutocompleteIndex(2, 3, 'ArrowDown')).toBe(0);
  });

  it('goes backward and wraps at the start on ArrowUp', () => {
    expect(getNextAutocompleteIndex(2, 3, 'ArrowUp')).toBe(1);
    expect(getNextAutocompleteIndex(0, 3, 'ArrowUp')).toBe(2);
  });
});

describe('getFStringAutocompleteHighlightedIndex', () => {
  it('clamps to the last option when activeIndex overshoots', () => {
    expect(getFStringAutocompleteHighlightedIndex(5, [1, 2])).toBe(1);
  });

  it('is -1 for an empty option list', () => {
    expect(getFStringAutocompleteHighlightedIndex(0, [])).toBe(-1);
  });
});

describe('getFStringAutocompleteInsertion', () => {
  it('inserts the selected variable and appends a closing brace when one is missing', () => {
    const state = getFStringAutocompleteState('say {na', 7);
    const insertion = getFStringAutocompleteInsertion('say {na', state, 'name');
    expect(insertion).toEqual({
      changeFrom: 5,
      changeTo: 7,
      cursorPosition: 10,
      insertText: 'name}',
      nextValue: 'say {name}',
    });
  });

  it('reuses an existing closing brace instead of appending a second one', () => {
    const state = getFStringAutocompleteState('say {na}', 7);
    const insertion = getFStringAutocompleteInsertion('say {na}', state, 'name');
    expect(insertion.insertText).toBe('name');
    expect(insertion.nextValue).toBe('say {name}');
  });
});

describe('createVirtualAnchorElement', () => {
  it('returns null for a null/undefined anchor position', () => {
    expect(createVirtualAnchorElement(null)).toBeNull();
    expect(createVirtualAnchorElement(undefined)).toBeNull();
  });

  it('wraps a caret position as a zero-size DOMRect-shaped virtual element', () => {
    const anchor = createVirtualAnchorElement({ top: 12, left: 34 });
    expect(anchor).not.toBeNull();
    const rect = anchor?.getBoundingClientRect();
    expect(rect).toMatchObject({ top: 12, left: 34, right: 34, bottom: 12, width: 0, height: 0, x: 34, y: 12 });
  });
});
