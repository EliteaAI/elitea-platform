import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { ControlsDropdownItem } from '.';
import { ControlsDropdown } from '.';

const baseItems: ControlsDropdownItem[] = [
  { key: 'rename', label: 'Rename', onClick: fn() },
  { key: 'duplicate', label: 'Duplicate', onClick: fn() },
  {
    key: 'delete',
    label: 'Delete',
    confirm: {
      message: 'Delete this agent?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm: fn(),
    },
  },
];

const nestedItems: ControlsDropdownItem[] = [
  { key: 'rename', label: 'Rename', onClick: fn() },
  {
    key: 'move',
    label: 'Move to',
    items: [
      { key: 'move-team-a', label: 'Team A', onClick: fn() },
      { key: 'move-team-b', label: 'Team B', onClick: fn() },
    ],
  },
];

const meta = {
  title: 'shared/ui/ControlsDropdown',
  component: ControlsDropdown,
  parameters: { a11y: { test: 'error' } },
  args: {
    items: baseItems,
  },
} satisfies Meta<typeof ControlsDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'More actions' });
    await expect(trigger).toBeInTheDocument();
  },
};

export const OpensOnClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: 'More actions' });
    await userEvent.click(trigger);
    await expect(body.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    await expect(body.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
  },
};

/**
 * Keyboard path: Enter opens the menu (MUI auto-focuses the first item —
 * "Rename" — on open), ArrowDown moves focus to the second item
 * ("Duplicate"), Enter activates it.
 */
export const KeyboardNavigation: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: 'More actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await expect(body.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    await expect(args.items[1]?.onClick).toHaveBeenCalledTimes(1);
  },
};

export const NestedSubmenu: Story = {
  args: { items: nestedItems },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: 'More actions' });
    await userEvent.click(trigger);
    await userEvent.click(body.getByRole('menuitem', { name: 'Move to' }));
    await expect(body.getByRole('menuitem', { name: 'Team A' })).toBeInTheDocument();
    await expect(body.getByRole('menuitem', { name: 'Team B' })).toBeInTheDocument();
  },
};

export const InlineConfirm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: 'More actions' });
    await userEvent.click(trigger);
    await userEvent.click(body.getByRole('menuitem', { name: 'Delete' }));
    await expect(body.getByText('Delete this agent?')).toBeInTheDocument();
    await expect(body.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();
    // The confirm row replaced the original "Delete" row rather than adding to it.
    await expect(body.queryAllByRole('menuitem', { name: 'Delete' })).toHaveLength(1);
  },
};

export const NoItemsRendersNothing: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};
