import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { StateVariableDefaultValue } from './StateVariableDefaultValue';

describe('StateVariableDefaultValue', () => {
  it('renders an inline field when the drawer is wide enough', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <StateVariableDefaultValue
        drawerWidth={400}
        defaultValue="hello"
        type="str"
        onChange={onChange}
      />,
    );

    const field = screen.getByPlaceholderText('Default value') as HTMLInputElement;
    expect(field.value).toBe('hello');
    fireEvent.change(field, { target: { value: 'world' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows the fullscreen button only once hovered is irrelevant to the click handler wiring', () => {
    const onIconClick = vi.fn();
    renderWithTheme(
      <StateVariableDefaultValue
        drawerWidth={400}
        defaultValue="hello"
        type="str"
        onIconClick={onIconClick}
      />,
    );

    fireEvent.click(screen.getByLabelText('Full screen view'));
    expect(onIconClick).toHaveBeenCalledTimes(1);
  });

  it('renders an icon button (not a field) when narrow and a non-default value is set', () => {
    const onIconClick = vi.fn();
    renderWithTheme(
      <StateVariableDefaultValue
        drawerWidth={200}
        defaultValue="hello"
        type="str"
        onIconClick={onIconClick}
      />,
    );

    expect(screen.queryByPlaceholderText('Default value')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onIconClick).toHaveBeenCalledTimes(1);
  });

  it('renders an "add default value" affordance when narrow and the value is still the type default', () => {
    renderWithTheme(
      <StateVariableDefaultValue
        drawerWidth={200}
        defaultValue=""
        type="str"
      />,
    );

    expect(screen.getByLabelText('Add default value (optional)')).toBeInTheDocument();
  });
});
