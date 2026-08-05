import { act } from 'react';

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { EditCellInput } from './EditCellInput';

describe('EditCellInput', () => {
  it('commits the new value ~30ms after a change (debounced auto-blur)', () => {
    vi.useFakeTimers();
    const onChangeValue = vi.fn();
    renderWithTheme(
      <EditCellInput
        id={1}
        field="name"
        row={{ isNew: false, name: 'old' }}
        onChangeValue={onChangeValue}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'new' } });
    expect(onChangeValue).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(onChangeValue).toHaveBeenCalledWith('new', expect.any(Function));
    vi.useRealTimers();
  });

  it('truncates input at maxLength', () => {
    vi.useFakeTimers();
    renderWithTheme(
      <EditCellInput
        id={1}
        field="name"
        row={{ isNew: true, name: '' }}
        onChangeValue={vi.fn()}
        maxLength={3}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abcdef' } });
    expect(input.value).toBe('abc');
    vi.useRealTimers();
  });

  it('restores the row value when onChangeValue signals an invalid name', () => {
    vi.useFakeTimers();
    const onChangeValue = vi.fn((_value: string, restore?: (needRestore: boolean) => void) => {
      restore?.(true);
    });
    renderWithTheme(
      <EditCellInput
        id={1}
        field="name"
        row={{ isNew: false, name: 'kept' }}
        onChangeValue={onChangeValue}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'bad name!' } });
    act(() => {
      vi.advanceTimersByTime(30);
    });

    expect(input.value).toBe('kept');
    vi.useRealTimers();
  });

  it('hides the actions toolbar surface when hasActionsToolBar is unset', () => {
    renderWithTheme(
      <EditCellInput
        id={1}
        field="name"
        row={{ isNew: false, name: 'x' }}
        onChangeValue={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Full screen view')).not.toBeInTheDocument();
  });

  it('shows the actions toolbar (full-screen button) when hasActionsToolBar is set', () => {
    renderWithTheme(
      <EditCellInput
        id={1}
        field="value"
        row={{ isNew: false, value: 'x' }}
        onChangeValue={vi.fn()}
        hasActionsToolBar
      />,
    );
    expect(screen.getByRole('button', { name: 'Full screen view' })).toBeInTheDocument();
  });

  it('does not call onChangeValue when the debounced blur fires but the value is unchanged', () => {
    vi.useFakeTimers();
    const onChangeValue = vi.fn();
    renderWithTheme(
      <EditCellInput
        id={1}
        field="name"
        row={{ isNew: false, name: 'same' }}
        onChangeValue={onChangeValue}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    // Round-trip back to the original value before the debounce fires.
    fireEvent.change(input, { target: { value: 'different' } });
    fireEvent.change(input, { target: { value: 'same' } });
    act(() => {
      vi.advanceTimersByTime(30);
    });

    expect(onChangeValue).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('seeds the initial value from a pretty-printed JSON string for a dict/list "value" field', () => {
    renderWithTheme(
      <EditCellInput
        id={1}
        field="value"
        row={{ isNew: false, type: 'dict', value: { a: 1 } }}
        onChangeValue={vi.fn()}
      />,
    );

    // A single-line `<input>` (not a `<textarea>`) drops embedded newline
    // characters entirely from its rendered `.value` — strip `\n` from the
    // expected pretty-printed string the same way before comparing.
    const input = screen.getByRole('textbox') as HTMLInputElement;
    const expected = JSON.stringify({ a: 1 }, null, 2).replace(/\n/g, '');
    expect(input.value).toBe(expected);
  });

  it('seeds an empty string when the JSON/list "value" field has no value yet', () => {
    renderWithTheme(
      <EditCellInput
        id={1}
        field="value"
        row={{ isNew: true, type: 'list', value: undefined }}
        onChangeValue={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('Enter is prevented (inserts a newline at the caret instead of submitting)', () => {
    renderWithTheme(
      <EditCellInput
        id={1}
        field="name"
        row={{ isNew: false, name: 'ab' }}
        onChangeValue={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.setSelectionRange(1, 1);

    // `fireEvent` returns `false` when the event's `preventDefault()` was called.
    const notCancelled = fireEvent.keyDown(input, { key: 'Enter' });

    expect(notCancelled).toBe(false);
  });

  it('a non-Enter key is left alone (not prevented, does not touch the value)', () => {
    renderWithTheme(
      <EditCellInput
        id={1}
        field="name"
        row={{ isNew: false, name: 'ab' }}
        onChangeValue={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    const notCancelled = fireEvent.keyDown(input, { key: 'a' });
    expect(notCancelled).toBe(true);
    expect(input.value).toBe('ab');
  });
});
