import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { DeleteEntityModal } from '.';

const meta = {
  title: 'shared/ui/modal/DeleteEntityModal',
  component: DeleteEntityModal,
  parameters: { a11y: { test: 'error' } },
  args: {
    open: true,
    name: 'prod-db',
    onClose: fn(),
    onConfirm: fn(),
  },
} satisfies Meta<typeof DeleteEntityModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByText('Delete confirmation')).toBeInTheDocument();
    await expect(canvas.getByText('prod-db')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  },
};

export const CustomCopy: Story = {
  args: {
    copy: { title: 'Remove agent?', confirmText: 'Remove', cancelText: 'Keep' },
  },
};

export const RequiresTypedName: Story = {
  args: { shouldRequestInputName: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const confirmButton = canvas.getByRole('button', { name: 'Delete' });
    await expect(confirmButton).toBeDisabled();

    const nameField = canvas.getByRole('textbox', { name: 'Name' });
    await userEvent.type(nameField, 'prod-db');
    await expect(confirmButton).not.toBeDisabled();
  },
};

export const WithExtraContent: Story = {
  args: {
    content: {
      extra: (
        <span style={{ color: 'inherit' }}>This also permanently deletes 3 linked backups.</span>
      ),
    },
  },
};

/** Keyboard path: focused Cancel/Confirm both reachable, Escape closes (inherited from `BaseModal`). */
export const ClosesOnEscape: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const dialog = canvas.getByRole('dialog');
    dialog.focus();
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};
