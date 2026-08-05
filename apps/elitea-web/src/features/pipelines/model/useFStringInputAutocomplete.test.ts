import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  useFStringInputAutocomplete,
  type UseFStringInputAutocompleteOptions,
} from './useFStringInputAutocomplete';

const OPTIONS = [{ value: 'name', label: 'Name' }];

function setup(overrides: Partial<UseFStringInputAutocompleteOptions> = {}) {
  const onInput = vi.fn();
  const initialProps: UseFStringInputAutocompleteOptions = {
    resolvedValue: 'foo {na',
    onInput,
    enabled: true,
    options: OPTIONS,
    ...overrides,
  };
  const hook = renderHook(
    (props: UseFStringInputAutocompleteOptions) => useFStringInputAutocomplete(props),
    { initialProps },
  );
  return { hook, onInput };
}

describe('useFStringInputAutocomplete', () => {
  it('exposes refs and a closed autocomplete state up front', () => {
    const { hook } = setup();
    expect(hook.result.current.containerRef.current).toBeNull();
    expect(hook.result.current.inputRef.current).toBeNull();
    expect(hook.result.current.autocompleteState.isOpen).toBe(false);
  });

  it('handleChange forwards the event to onInput and opens the popper for the new caret position', () => {
    const { hook, onInput } = setup();
    const event = { preventDefault: vi.fn(), target: { value: '{ba', selectionStart: 3 } };

    act(() => {
      hook.result.current.handleChange(event);
    });

    expect(onInput).toHaveBeenCalledWith(event);
    expect(hook.result.current.autocompleteState.isOpen).toBe(true);
    expect(hook.result.current.autocompleteState.query).toBe('ba');
  });

  it('handleChange falls back to the value length when selectionStart is missing', () => {
    const { hook, onInput } = setup();
    const event = { preventDefault: vi.fn(), target: { value: '{ba' } };

    act(() => {
      hook.result.current.handleChange(event);
    });

    expect(onInput).toHaveBeenCalledWith(event);
    expect(hook.result.current.autocompleteState.query).toBe('ba');
  });

  it('handleCursorChange is a no-op when the event carries no target value', () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.handleChange({ preventDefault: vi.fn(), target: { value: '{ba', selectionStart: 3 } });
    });
    const stateBefore = hook.result.current.autocompleteState;

    act(() => {
      hook.result.current.handleCursorChange({});
    });

    expect(hook.result.current.autocompleteState).toBe(stateBefore);
  });

  it('handleCursorChange re-derives the popper state for a new caret position, preserving the active index for the same query', () => {
    const { hook } = setup({ options: [...OPTIONS, { value: 'namespace', label: 'Namespace' }] });
    act(() => {
      hook.result.current.handleChange({ preventDefault: vi.fn(), target: { value: 'foo {na', selectionStart: 7 } });
    });
    act(() => {
      hook.result.current.handleAutocompleteKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() });
    });
    expect(hook.result.current.autocompleteState.activeIndex).toBe(1);

    act(() => {
      hook.result.current.handleCursorChange({ target: { value: 'foo {na', selectionStart: 7 } });
    });

    expect(hook.result.current.autocompleteState.query).toBe('na');
    expect(hook.result.current.autocompleteState.activeIndex).toBe(1);
  });

  it('selecting a suggestion commits it via onInput and, once the caller echoes the new value back, re-focuses the input at the caret', async () => {
    const focus = vi.fn();
    const setSelectionRange = vi.fn();
    const fakeInput = { focus, setSelectionRange } as unknown as HTMLInputElement & HTMLTextAreaElement;

    const { hook, onInput } = setup();
    hook.result.current.inputRef.current = fakeInput;

    act(() => {
      hook.result.current.handleChange({ preventDefault: vi.fn(), target: { value: 'foo {na', selectionStart: 7 } });
    });
    expect(hook.result.current.filteredOptions).toHaveLength(1);

    act(() => {
      hook.result.current.handleAutocompleteKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    });

    expect(onInput).toHaveBeenCalledWith(
      expect.objectContaining({ target: { value: 'foo {name}' } }),
    );
    // Commit is synthesised, not a real DOM event — the popper itself is
    // already closed, but the caret has not moved yet (that happens once
    // the controlled `resolvedValue` prop below echoes the commit back).
    expect(hook.result.current.autocompleteState.isOpen).toBe(false);
    expect(focus).not.toHaveBeenCalled();

    // The parent component is controlled: it only re-renders this hook with
    // the new resolvedValue once onInput's caller has applied it.
    hook.rerender({ resolvedValue: 'foo {name}', onInput, enabled: true, options: OPTIONS });

    await waitFor(() => {
      expect(focus).toHaveBeenCalledTimes(1);
    });
    // replaceStart (5) + 'name'.length (4) + 1
    expect(setSelectionRange).toHaveBeenCalledWith(10, 10);
  });

  it('does not schedule a caret reposition when no suggestion has been committed', () => {
    const { hook } = setup();
    // resolvedValue changing without a prior suggestion-select must not
    // touch inputRef at all -- pendingCursorPositionRef stays null.
    expect(() => hook.rerender({ resolvedValue: 'foo {nb', onInput: vi.fn(), enabled: true, options: OPTIONS })).not.toThrow();
  });
});
