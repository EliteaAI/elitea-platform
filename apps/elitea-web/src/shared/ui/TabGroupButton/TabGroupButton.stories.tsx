import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { TabGroupButtonItem } from '.';
import { TabGroupButton } from '.';

const items: TabGroupButtonItem[] = [
  { value: 'list', label: 'List' },
  { value: 'grid', label: 'Grid' },
  { value: 'board', label: 'Board' },
];

const meta = {
  title: 'shared/ui/TabGroupButton',
  component: TabGroupButton,
  parameters: { a11y: { test: 'error' } },
  args: {
    items,
    ariaLabel: 'View toggle',
    onChange: fn(),
  },
} satisfies Meta<typeof TabGroupButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: 'View toggle' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'List' })).toBeInTheDocument();
  },
};

export const UncontrolledSelectsFirstItemByDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  },
};

export const ClickingSelectsAndCallsOnChange: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Grid' }));
    await expect(args.onChange).toHaveBeenCalledWith('grid');
    await expect(canvas.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
  },
};

export const ClickingSelectedAgainStaysSelected: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const listButton = canvas.getByRole('button', { name: 'List' });
    await expect(listButton).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(listButton);
    // MUI's exclusive ToggleButtonGroup would otherwise fire `null` — the
    // group keeps exactly one button always selected.
    await expect(listButton).toHaveAttribute('aria-pressed', 'true');
    await expect(args.onChange).not.toHaveBeenCalledWith(null);
  },
};

/**
 * Keyboard path. Since MUI 9.4.0 `ToggleButtonGroup` roves its tab index:
 * the group is one Tab stop and Left/Right move focus between the buttons
 * (Home/End jump, wrapping). Enter activates the focused one. Before 9.4
 * each button was its own Tab stop, and this story pinned that; #680's
 * bump is what changed the contract.
 */
export const KeyboardNavigation: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const listButton = canvas.getByRole('button', { name: 'List' });
    listButton.focus();
    await expect(listButton).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    const gridButton = canvas.getByRole('button', { name: 'Grid' });
    await expect(gridButton).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('grid');
  },
};

export const ControlledValue: Story = {
  args: { value: 'board' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
  },
};
