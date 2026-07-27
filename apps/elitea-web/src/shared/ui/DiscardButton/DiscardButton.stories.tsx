import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { DiscardButton } from '.';

const meta = {
  title: 'shared/ui/DiscardButton',
  component: DiscardButton,
  parameters: { a11y: { test: 'error' } },
  args: { onDiscard: fn() },
} satisfies Meta<typeof DiscardButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Discard' })).toBeDisabled();
  },
};

export const SavingDisablesTheButton: Story = {
  args: { isSaving: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Discard' })).toBeDisabled();
  },
};

// `BaseModal` renders through MUI's `Dialog` portal, outside `canvasElement`
// — queried against `document.body`, same pattern `BaseModal.stories.tsx` uses.
export const OpensConfirmModal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Discard' }));
    await expect(body.getByText('Warning')).toBeInTheDocument();
    await expect(
      body.getByText('Are you sure you want to discard changes?'),
    ).toBeInTheDocument();
  },
};

export const ConfirmingDiscards: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Discard' }));
    // The trigger and the modal's confirm button share the name "Discard" —
    // scope to the dialog to reach the confirm button unambiguously.
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await expect(args.onDiscard).toHaveBeenCalledTimes(1);
  },
};
