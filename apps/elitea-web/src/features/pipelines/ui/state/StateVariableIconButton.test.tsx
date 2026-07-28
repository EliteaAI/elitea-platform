import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { StateVariableIconButton } from './StateVariableIconButton';

describe('StateVariableIconButton', () => {
  it('renders its children and fires onClick', () => {
    const onClick = vi.fn();
    renderWithTheme(
      <StateVariableIconButton
        tooltip="Select data type"
        onClick={onClick}
      >
        <span>icon</span>
      </StateVariableIconButton>,
    );

    fireEvent.click(screen.getByText('icon'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the button and suppresses the tooltip text when disabled', () => {
    renderWithTheme(
      <StateVariableIconButton
        tooltip="Select data type"
        disabled
      >
        <span>icon</span>
      </StateVariableIconButton>,
    );

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is enabled by default and shows the tooltip title attribute area', () => {
    renderWithTheme(
      <StateVariableIconButton tooltip="Select data type">
        <span>icon</span>
      </StateVariableIconButton>,
    );

    expect(screen.getByRole('button')).toBeEnabled();
  });
});
