import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { BaseModal } from '.';

const meta = {
  title: 'shared/ui/BaseModal',
  component: BaseModal,
  parameters: { a11y: { test: 'error' } },
  args: {
    open: true,
    title: 'Delete agent',
    content: 'This action cannot be undone.',
    onClose: fn(),
    onConfirm: fn(),
  },
} satisfies Meta<typeof BaseModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByText('Delete agent')).toBeInTheDocument();
    await expect(canvas.getByText('This action cannot be undone.')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  },
};

export const Simple: Story = {
  args: { variant: 'simple' },
};

export const AlarmConfirm: Story = {
  args: { actions: { alarm: true, confirmText: 'Delete', cancelText: 'Keep' } },
};

export const Confirming: Story = {
  args: { actions: { confirming: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  },
};

export const CustomActions: Story = {
  args: { actions: { node: <span>custom actions</span> } },
};

export const Fullscreen: Story = {
  args: { fullscreen: true },
};

/** Keyboard path: Escape closes; Tab reaches Cancel and Confirm. */
export const ClosesOnEscape: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const dialog = canvas.getByRole('dialog');
    dialog.focus();
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};

export const ConfirmsWithKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const confirmButton = canvas.getByRole('button', { name: 'Confirm' });
    confirmButton.focus();
    await expect(confirmButton).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onConfirm).toHaveBeenCalled();
  },
};
