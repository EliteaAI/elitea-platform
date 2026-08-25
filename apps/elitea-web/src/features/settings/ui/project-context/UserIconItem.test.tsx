/**
 * The delete control of `UserIconItem` is an icon-only `IconButton`.
 *
 * `CloseIcon` renders an `<svg>` with no text, so the button had an empty
 * accessible name. The icon grid repeats the item many times, so a screen
 * reader announced a row of identical, unnamed buttons beside each icon.
 *
 * This test queries the control by its accessible name, then confirms the
 * delete flow still needs the confirmation dialog.
 *
 * The queries use `ByLabelText`, not `ByRole`. The button carries
 * `visibility: hidden` until the wrapper gets a CSS hover. jsdom applies no
 * hover state, and a hidden element computes an empty accessible name.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { UserIconItem } from './UserIconItem';

describe('UserIconItem', () => {
  it('names the delete control and opens the confirmation dialog', async () => {
    const onDelete = vi.fn();
    renderWithTheme(
      <UserIconItem
        isSelected={false}
        onDelete={onDelete}
      >
        <span>icon</span>
      </UserIconItem>,
    );

    await userEvent.click(screen.getByLabelText('Delete the icon'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('renders no delete control while onDelete is absent', () => {
    renderWithTheme(
      <UserIconItem isSelected={false}>
        <span>icon</span>
      </UserIconItem>,
    );

    expect(screen.queryByLabelText('Delete the icon')).not.toBeInTheDocument();
  });
});
