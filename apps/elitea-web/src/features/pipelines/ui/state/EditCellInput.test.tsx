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
});
