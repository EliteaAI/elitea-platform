import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AddNodeMenu } from './AddNodeMenu';

describe('AddNodeMenu', () => {
  it('opens the menu on trigger click and lists every non-deprecated node type once, alphabetically', async () => {
    const user = userEvent.setup();
    renderWithTheme(<AddNodeMenu onAddNode={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Add node' }));

    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    const labels = items.map((item) => item.textContent);

    // Deprecated/invisible node types must never appear.
    expect(labels).not.toContain('Tool');
    expect(labels).not.toContain('Function');
    expect(labels).not.toContain('Condition');
    expect(labels).not.toContain('Pipeline');
    expect(labels).not.toContain('Loop');
    expect(labels).not.toContain('Loop from tool');
    expect(labels).not.toContain('End');
    expect(labels).not.toContain('Ghost');
    expect(labels).not.toContain('Default');

    // A representative non-deprecated type must be present.
    expect(labels).toContain('Agent');
    expect(labels).toContain('LLM');

    // Sorted case-insensitively, ascending.
    const sorted = [...labels].sort((a, b) => (a ?? '').toLowerCase().localeCompare((b ?? '').toLowerCase()));
    expect(labels).toEqual(sorted);
  });

  it('calls onAddNode with the clicked type and closes the menu', async () => {
    const user = userEvent.setup();
    const onAddNode = vi.fn();
    renderWithTheme(<AddNodeMenu onAddNode={onAddNode} />);

    await user.click(screen.getByRole('button', { name: 'Add node' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByText('Agent'));

    expect(onAddNode).toHaveBeenCalledWith('agent');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('disables the trigger button when disabled is true', () => {
    renderWithTheme(<AddNodeMenu onAddNode={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Add node' })).toBeDisabled();
  });
});
