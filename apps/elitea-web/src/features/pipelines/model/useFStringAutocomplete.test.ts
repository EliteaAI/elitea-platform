import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFStringAutocomplete, type UseFStringAutocompleteOptions } from './useFStringAutocomplete';

const OPTIONS = [
  { value: 'foo', label: 'Foo' },
  { value: 'bar', label: 'Bar' },
  { value: 'baz', label: 'Baz' },
];

function setup(overrides: Partial<UseFStringAutocompleteOptions> = {}) {
  const onSelect = vi.fn();
  const hook = renderHook((props: UseFStringAutocompleteOptions) => useFStringAutocomplete(props), {
    initialProps: { enabled: true, options: OPTIONS, onSelect, ...overrides },
  });
  return { hook, onSelect };
}

describe('useFStringAutocomplete', () => {
  it('starts closed with no filtered options', () => {
    const { hook } = setup();
    expect(hook.result.current.autocompleteState.isOpen).toBe(false);
    expect(hook.result.current.filteredOptions).toEqual([]);
    expect(hook.result.current.highlightedOptionIndex).toBe(-1);
  });

  it('opens and filters options when the input text enters a `{query` span', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    expect(hook.result.current.autocompleteState.isOpen).toBe(true);
    expect(hook.result.current.autocompleteState.query).toBe('ba');
    expect(hook.result.current.filteredOptions.map((o) => o.value)).toEqual(['bar', 'baz']);
    expect(hook.result.current.highlightedOptionIndex).toBe(0);
  });

  it('stays closed regardless of input when disabled', () => {
    const { hook } = setup({ enabled: false });
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    expect(hook.result.current.autocompleteState.isOpen).toBe(false);
  });

  it('stays closed when there are no options to suggest', () => {
    const { hook } = setup({ options: [] });
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    expect(hook.result.current.autocompleteState.isOpen).toBe(false);
  });

  it('ArrowDown/ArrowUp move the highlighted index and wrap at the ends', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    expect(hook.result.current.filteredOptions).toHaveLength(2);

    let handled = false;
    act(() => {
      handled = hook.result.current.handleAutocompleteKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() });
    });
    expect(handled).toBe(true);
    expect(hook.result.current.highlightedOptionIndex).toBe(1);

    act(() => {
      hook.result.current.handleAutocompleteKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() });
    });
    expect(hook.result.current.highlightedOptionIndex).toBe(0);

    act(() => {
      hook.result.current.handleAutocompleteKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() });
    });
    expect(hook.result.current.highlightedOptionIndex).toBe(1);
  });

  it('Enter selects the highlighted option, calls onSelect, and closes', () => {
    const { hook, onSelect } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    const preventDefault = vi.fn();

    let handled = false;
    act(() => {
      handled = hook.result.current.handleAutocompleteKeyDown({ key: 'Enter', preventDefault });
    });

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('bar', expect.objectContaining({ isOpen: true, query: 'ba' }));
    expect(hook.result.current.autocompleteState.isOpen).toBe(false);
  });

  it('Escape closes the popper and prevents the default action', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    const preventDefault = vi.fn();

    let handled = false;
    act(() => {
      handled = hook.result.current.handleAutocompleteKeyDown({ key: 'Escape', preventDefault });
    });

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(hook.result.current.autocompleteState.isOpen).toBe(false);
  });

  it('an unhandled key is ignored (no preventDefault, returns false)', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    const preventDefault = vi.fn();

    let handled = true;
    act(() => {
      handled = hook.result.current.handleAutocompleteKeyDown({ key: 'a', preventDefault });
    });

    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('ignores navigation keys while closed', () => {
    const { hook } = setup();
    let handled = true;
    act(() => {
      handled = hook.result.current.handleAutocompleteKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() });
    });
    expect(handled).toBe(false);
  });

  it('Enter is a no-op when there are no options to select (nothing configured)', () => {
    const { hook, onSelect } = setup({ options: [] });
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    let handled = true;
    act(() => {
      handled = hook.result.current.handleAutocompleteKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    });
    expect(handled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Enter is a no-op once the in-progress query filters every option out', () => {
    const { hook, onSelect } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{zzz', 4);
    });
    expect(hook.result.current.autocompleteState.isOpen).toBe(true);
    expect(hook.result.current.filteredOptions).toEqual([]);

    let handled = true;
    act(() => {
      handled = hook.result.current.handleAutocompleteKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    });
    expect(handled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('preserveActiveIndex keeps the active index across an update for the same query', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    act(() => {
      hook.result.current.handleAutocompleteKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() });
    });
    expect(hook.result.current.autocompleteState.activeIndex).toBe(1);

    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3, { preserveActiveIndex: true });
    });
    expect(hook.result.current.autocompleteState.activeIndex).toBe(1);
  });

  it('preserveActiveIndex still resets the active index once the query changes', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    act(() => {
      hook.result.current.handleAutocompleteKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() });
    });
    expect(hook.result.current.autocompleteState.activeIndex).toBe(1);

    act(() => {
      hook.result.current.updateAutocompleteState('{baz', 4, { preserveActiveIndex: true });
    });
    expect(hook.result.current.autocompleteState.query).toBe('baz');
    expect(hook.result.current.autocompleteState.activeIndex).toBe(0);
  });

  it('closeAutocomplete resets to the closed state', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    act(() => {
      hook.result.current.closeAutocomplete();
    });
    expect(hook.result.current.autocompleteState.isOpen).toBe(false);
  });

  it('setActiveIndex sets the active index directly', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.updateAutocompleteState('{ba', 3);
    });
    act(() => {
      hook.result.current.setActiveIndex(1);
    });
    expect(hook.result.current.autocompleteState.activeIndex).toBe(1);
    expect(hook.result.current.highlightedOptionIndex).toBe(1);
  });
});
