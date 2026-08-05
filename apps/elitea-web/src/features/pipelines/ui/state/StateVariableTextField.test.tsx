import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { StateVariableTextField } from './StateVariableTextField';

describe('StateVariableTextField', () => {
  it('renders the given value and forwards onChange', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <StateVariableTextField
        value="my_var"
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('my_var');

    fireEvent.change(input, { target: { value: 'other_var' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('suppresses onBlur/onKeyDown when disabled', () => {
    const onBlur = vi.fn();
    const onKeyDown = vi.fn();
    renderWithTheme(
      <StateVariableTextField
        value="x"
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        disabled
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onBlur).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('wires onBlur/onKeyDown through when enabled', () => {
    const onBlur = vi.fn();
    const onKeyDown = vi.fn();
    renderWithTheme(
      <StateVariableTextField
        value="x"
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('shows the placeholder text', () => {
    renderWithTheme(
      <StateVariableTextField
        value=""
        placeholder="name"
      />,
    );
    expect(screen.getByPlaceholderText('name')).toBeInTheDocument();
  });
});
