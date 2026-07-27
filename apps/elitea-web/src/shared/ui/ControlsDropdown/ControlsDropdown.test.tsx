import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import type { ControlsDropdownItem } from '.';
import { ControlsDropdown } from '.';

// MUI's `Menu` renders through a portal to `document.body`. RTL's `render()`
// defaults `baseElement` to `document.body`, so the bound queries below
// (`getByRole`, `queryByRole`, …) already see portaled content.

describe('ControlsDropdown', () => {
  it('renders nothing when there are no items', () => {
    const { queryByRole } = renderWithTheme(<ControlsDropdown items={[]} />);
    expect(queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a trigger button with a default accessible name', () => {
    const { getByRole } = renderWithTheme(
      <ControlsDropdown items={[{ key: 'a', label: 'A', onClick: () => {} }]} />,
    );
    expect(getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });

  it('accepts a custom trigger accessible name', () => {
    const { getByRole } = renderWithTheme(
      <ControlsDropdown
        items={[{ key: 'a', label: 'A', onClick: () => {} }]}
        triggerAriaLabel="Row actions"
      />,
    );
    expect(getByRole('button', { name: 'Row actions' })).toBeInTheDocument();
  });

  it('opens the menu and lists every item on trigger click', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(
      <ControlsDropdown
        items={[
          { key: 'rename', label: 'Rename', onClick: () => {} },
          { key: 'duplicate', label: 'Duplicate', onClick: () => {} },
        ]}
      />,
    );
    await user.click(getByRole('button', { name: 'More actions' }));
    expect(getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
  });

  it('renders a row icon when the item has one', async () => {
    const user = userEvent.setup();
    const { getByRole, getByTestId } = renderWithTheme(
      <ControlsDropdown
        items={[{ key: 'rename', label: 'Rename', icon: <span data-testid="row-icon" />, onClick: () => {} }]}
      />,
    );
    await user.click(getByRole('button', { name: 'More actions' }));
    expect(getByTestId('row-icon')).toBeInTheDocument();
  });

  it('calls onClick and closes the menu when a plain item is activated', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole, queryByRole } = renderWithTheme(
      <ControlsDropdown items={[{ key: 'rename', label: 'Rename', onClick }]} />,
    );
    await user.click(getByRole('button', { name: 'More actions' }));
    await user.click(getByRole('menuitem', { name: 'Rename' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('marks a disabled item as non-interactive (no pointer events, aria-disabled)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(
      <ControlsDropdown items={[{ key: 'rename', label: 'Rename', onClick, disabled: true }]} />,
    );
    await user.click(getByRole('button', { name: 'More actions' }));
    const row = getByRole('menuitem', { name: 'Rename' });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    // A real user cannot click through `pointer-events: none` — this IS the
    // proof onClick is unreachable, not a test-authoring gap.
    await expect(user.click(row)).rejects.toThrow(/pointer-events: none/);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('supports full keyboard traversal: Enter opens, ArrowDown moves, Enter activates', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(
      <ControlsDropdown
        items={[
          { key: 'rename', label: 'Rename', onClick: () => {} },
          { key: 'duplicate', label: 'Duplicate', onClick },
        ]}
      />,
    );
    const trigger = getByRole('button', { name: 'More actions' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('closes the menu on Escape without activating anything', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole, queryByRole } = renderWithTheme(
      <ControlsDropdown items={[{ key: 'rename', label: 'Rename', onClick }]} />,
    );
    await user.click(getByRole('button', { name: 'More actions' }));
    expect(getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  describe('inline confirm', () => {
    const items: ControlsDropdownItem[] = [
      {
        key: 'delete',
        label: 'Delete',
        confirm: {
          message: 'Delete this agent?',
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          onConfirm: vi.fn(),
        },
      },
    ];

    it('replaces the row with a message and Cancel/Confirm pair, keeping the menu open', async () => {
      const user = userEvent.setup();
      const { getByRole, getByText, queryByRole } = renderWithTheme(<ControlsDropdown items={items} />);
      await user.click(getByRole('button', { name: 'More actions' }));
      await user.click(getByRole('menuitem', { name: 'Delete' }));
      expect(getByText('Delete this agent?')).toBeInTheDocument();
      expect(getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();
      // Exactly one "Delete" menuitem remains (the confirm button), not two.
      expect(queryByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
      expect(getByRole('menu')).toBeInTheDocument();
    });

    it('Cancel reverts to the normal row without confirming', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const { getByRole, queryByText } = renderWithTheme(
        <ControlsDropdown
          items={[
            {
              key: 'delete',
              label: 'Delete',
              confirm: { message: 'Delete this agent?', onConfirm },
            },
          ]}
        />,
      );
      await user.click(getByRole('button', { name: 'More actions' }));
      await user.click(getByRole('menuitem', { name: 'Delete' }));
      await user.click(getByRole('menuitem', { name: 'Cancel' }));
      expect(queryByText('Delete this agent?')).not.toBeInTheDocument();
      expect(getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('confirming calls onConfirm and closes the menu', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const { getByRole, queryByRole } = renderWithTheme(
        <ControlsDropdown
          items={[
            {
              key: 'delete',
              label: 'Delete',
              confirm: { message: 'Delete this agent?', confirmLabel: 'Yes, delete', onConfirm },
            },
          ]}
        />,
      );
      await user.click(getByRole('button', { name: 'More actions' }));
      await user.click(getByRole('menuitem', { name: 'Delete' }));
      await user.click(getByRole('menuitem', { name: 'Yes, delete' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('nested submenu', () => {
    it('opens a flyout listing the nested items, anchored to the parent row', async () => {
      const user = userEvent.setup();
      const { getByRole } = renderWithTheme(
        <ControlsDropdown
          items={[
            {
              key: 'move',
              label: 'Move to',
              items: [
                { key: 'team-a', label: 'Team A', onClick: () => {} },
                { key: 'team-b', label: 'Team B', onClick: () => {} },
              ],
            },
          ]}
        />,
      );
      await user.click(getByRole('button', { name: 'More actions' }));
      await user.click(getByRole('menuitem', { name: 'Move to' }));
      expect(getByRole('menuitem', { name: 'Team A' })).toBeInTheDocument();
      expect(getByRole('menuitem', { name: 'Team B' })).toBeInTheDocument();
    });

    it('activating a submenu leaf calls its onClick and closes both menus', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      const { getByRole, queryByRole } = renderWithTheme(
        <ControlsDropdown
          items={[
            {
              key: 'move',
              label: 'Move to',
              items: [{ key: 'team-a', label: 'Team A', onClick }],
            },
          ]}
        />,
      );
      await user.click(getByRole('button', { name: 'More actions' }));
      await user.click(getByRole('menuitem', { name: 'Move to' }));
      await user.click(getByRole('menuitem', { name: 'Team A' }));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(queryByRole('menuitem', { name: 'Move to' })).not.toBeInTheDocument();
      expect(queryByRole('menuitem', { name: 'Team A' })).not.toBeInTheDocument();
    });

    it('supports inline confirm on a submenu leaf', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const { getByRole, getByText } = renderWithTheme(
        <ControlsDropdown
          items={[
            {
              key: 'move',
              label: 'Move to',
              items: [
                {
                  key: 'archive',
                  label: 'Archive team',
                  confirm: { message: 'Archive this team?', onConfirm },
                },
              ],
            },
          ]}
        />,
      );
      await user.click(getByRole('button', { name: 'More actions' }));
      await user.click(getByRole('menuitem', { name: 'Move to' }));
      await user.click(getByRole('menuitem', { name: 'Archive team' }));
      expect(getByText('Archive this team?')).toBeInTheDocument();
    });

    it('closing the submenu on its own (Escape, focused inside it) resets its confirm state without closing the top menu', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const { getByRole, getByText, queryByRole, queryByText } = renderWithTheme(
        <ControlsDropdown
          items={[
            {
              key: 'move',
              label: 'Move to',
              items: [
                {
                  key: 'archive',
                  label: 'Archive team',
                  confirm: { message: 'Archive this team?', onConfirm },
                },
              ],
            },
          ]}
        />,
      );
      await user.click(getByRole('button', { name: 'More actions' }));
      await user.click(getByRole('menuitem', { name: 'Move to' }));
      await user.click(getByRole('menuitem', { name: 'Archive team' }));
      expect(getByText('Archive this team?')).toBeInTheDocument();

      // Focus a row inside the submenu first — MUI's `Menu` handles Escape
      // via the focused element's own scope, and (per the earlier
      // KeyboardNavigation test in this file) DOM focus does not move into
      // a freshly-opened Menu synchronously by itself in this environment.
      getByRole('menuitem', { name: 'Cancel' }).focus();
      await user.keyboard('{Escape}');

      expect(queryByText('Archive this team?')).not.toBeInTheDocument();
      expect(queryByRole('menuitem', { name: 'Archive team' })).not.toBeInTheDocument();
      // The top-level menu is still open — only the submenu layer closed.
      expect(getByRole('menuitem', { name: 'Move to' })).toBeInTheDocument();
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  it('renders a custom trigger icon in place of the default', () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ControlsDropdown
        items={[{ key: 'a', label: 'A', onClick: () => {} }]}
        triggerIcon={<span data-testid="custom-trigger-icon" />}
      />,
    );
    expect(getByTestId('custom-trigger-icon')).toBeInTheDocument();
    expect(queryByTestId('default-icon')).not.toBeInTheDocument();
  });

  it('disables the trigger button when disabled is set', () => {
    const { getByRole } = renderWithTheme(
      <ControlsDropdown
        items={[{ key: 'a', label: 'A', onClick: () => {} }]}
        disabled
      />,
    );
    expect(getByRole('button', { name: 'More actions' })).toBeDisabled();
  });
});
