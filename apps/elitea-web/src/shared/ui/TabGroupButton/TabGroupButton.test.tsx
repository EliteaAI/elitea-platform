import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import type { TabGroupButtonItem } from '.';
import { TabGroupButton } from '.';

const items: TabGroupButtonItem[] = [
  { value: 'list', label: 'List' },
  { value: 'grid', label: 'Grid' },
  { value: 'board', label: 'Board' },
];

describe('TabGroupButton', () => {
  it('renders a labeled group with a button per item', () => {
    const { getByRole } = renderWithTheme(
      <TabGroupButton
        items={items}
        ariaLabel="View toggle"
      />,
    );
    expect(getByRole('group', { name: 'View toggle' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'List' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Grid' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Board' })).toBeInTheDocument();
  });

  it('selects the first item by default when uncontrolled with no defaultValue', () => {
    const { getByRole } = renderWithTheme(<TabGroupButton items={items} />);
    expect(getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('honours defaultValue for the initial uncontrolled selection', () => {
    const { getByRole } = renderWithTheme(
      <TabGroupButton
        items={items}
        defaultValue="grid"
      />,
    );
    expect(getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('updates selection and calls onChange when uncontrolled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <TabGroupButton
        items={items}
        onChange={onChange}
      />,
    );
    await user.click(getByRole('button', { name: 'Board' }));
    expect(onChange).toHaveBeenCalledWith('board');
    expect(getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not deselect the current button when it is clicked again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <TabGroupButton
        items={items}
        onChange={onChange}
      />,
    );
    const listButton = getByRole('button', { name: 'List' });
    await user.click(listButton);
    expect(listButton).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('respects a controlled value and ignores its own internal state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole, rerender } = renderWithTheme(
      <TabGroupButton
        items={items}
        value="grid"
        onChange={onChange}
      />,
    );
    expect(getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(getByRole('button', { name: 'Board' }));
    expect(onChange).toHaveBeenCalledWith('board');
    // The caller did not update `value`, so the controlled selection stays put.
    expect(getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');

    rerender(
      <TabGroupButton
        items={items}
        value="board"
        onChange={onChange}
      />,
    );
    expect(getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps every button independently reachable by Tab (MUI ToggleButtonGroup does not roam focus on arrow keys)', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<TabGroupButton items={items} />);
    getByRole('button', { name: 'List' }).focus();
    await user.tab();
    expect(getByRole('button', { name: 'Grid' })).toHaveFocus();
    await user.tab();
    expect(getByRole('button', { name: 'Board' })).toHaveFocus();
  });

  it('activates a focused button with the keyboard (Enter)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <TabGroupButton
        items={items}
        onChange={onChange}
      />,
    );
    getByRole('button', { name: 'Grid' }).focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('grid');
  });

  it('forwards disableTooltip to every item', () => {
    const { queryByRole } = renderWithTheme(
      <TabGroupButton
        items={items}
        disableTooltip
      />,
    );
    expect(queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders an empty group with nothing selected when items is empty and no defaultValue is given', () => {
    const { getByRole, queryByRole } = renderWithTheme(<TabGroupButton items={[]} />);
    expect(getByRole('group')).toBeInTheDocument();
    expect(queryByRole('button')).not.toBeInTheDocument();
  });
});
