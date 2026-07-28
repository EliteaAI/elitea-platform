import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { StateVariableItem, type StateVariableItemProps } from './StateVariableItem';

function baseProps(overrides: Partial<StateVariableItemProps> = {}): StateVariableItemProps {
  return {
    name: 'my_var',
    type: 'str',
    defaultValue: '',
    ...overrides,
  };
}

describe('StateVariableItem', () => {
  it('renders the name as a static label in display mode', () => {
    renderWithTheme(<StateVariableItem {...baseProps()} />);
    expect(screen.getByText('my_var')).toBeInTheDocument();
  });

  it('switches to an editable text field on click and commits a renamed value on blur', () => {
    const onUpdateName = vi.fn();
    renderWithTheme(
      <StateVariableItem
        {...baseProps()}
        onUpdateName={onUpdateName}
      />,
    );

    fireEvent.click(screen.getByText('my_var'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('my_var');

    fireEvent.change(input, { target: { value: 'renamed' } });
    fireEvent.blur(input);

    expect(onUpdateName).toHaveBeenCalledWith('my_var', 'renamed');
  });

  it('renders a create-mode text field immediately and cancels on empty blur', () => {
    const onCancel = vi.fn();
    renderWithTheme(
      <StateVariableItem
        {...baseProps({ name: '', mode: 'create' })}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByPlaceholderText('name');
    fireEvent.blur(input);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the validate-name error under the row and blocks the rename on blur', () => {
    const onUpdateName = vi.fn();
    const validateName = vi.fn(() => 'Name already exists');
    renderWithTheme(
      <StateVariableItem
        {...baseProps()}
        validateName={validateName}
        onUpdateName={onUpdateName}
      />,
    );

    fireEvent.click(screen.getByText('my_var'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'taken' } });
    expect(screen.getByText('Name already exists')).toBeInTheDocument();

    fireEvent.blur(input);
    expect(onUpdateName).not.toHaveBeenCalled();
  });

  it('calls onDelete(name) when the delete action is clicked in display mode', () => {
    const onDelete = vi.fn();
    renderWithTheme(
      <StateVariableItem
        {...baseProps()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('my_var');
  });

  it('opens the fullscreen default-value viewer and commits an edited value on blur', () => {
    const onUpdateDefaultValue = vi.fn();
    renderWithTheme(
      <StateVariableItem
        {...baseProps({ drawerWidth: 200, defaultValue: 'hello' })}
        onUpdateDefaultValue={onUpdateDefaultValue}
      />,
    );

    fireEvent.click(screen.getByLabelText('Default value (optional)'));
    expect(screen.getByText('Default value')).toBeInTheDocument();
  });

  it('renders a toggle switch for a default (input/messages) row', () => {
    const onToggle = vi.fn();
    renderWithTheme(
      <StateVariableItem
        {...baseProps({ name: 'input', isDefault: true, enabled: true })}
        onToggle={onToggle}
      />,
    );

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('input', false);
  });
});
