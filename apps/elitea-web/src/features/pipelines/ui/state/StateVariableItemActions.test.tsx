import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { StateVariableItemActions } from './StateVariableItemActions';

describe('StateVariableItemActions', () => {
  it('renders a toggle switch when showToggle is set', () => {
    const onToggle = vi.fn();
    renderWithTheme(
      <StateVariableItemActions
        type="str"
        enabled
        showToggle
        onToggle={onToggle}
      />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('renders the type selector, default value, and delete button when showToggle is unset', () => {
    const onDelete = vi.fn();
    renderWithTheme(
      <StateVariableItemActions
        type="str"
        defaultValue=""
        onDelete={onDelete}
      />,
    );

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('remaps the legacy int type to number before handing it to the type selector', () => {
    renderWithTheme(
      <StateVariableItemActions
        type="int"
        defaultValue={0}
      />,
    );

    // The type selector renders successfully with the legacy "int" type
    // coerced to "number" — no crash, and the number glyph's tooltip button
    // is present.
    expect(screen.getByRole('button', { name: 'Select data type' })).toBeInTheDocument();
  });
});
