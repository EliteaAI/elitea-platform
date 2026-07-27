import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { AddButton } from '.';

const meta = {
  title: 'shared/ui/AddButton',
  component: AddButton,
  parameters: { a11y: { test: 'error' } },
  args: { onAdd: fn() },
} satisfies Meta<typeof AddButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomTooltip: Story = {
  args: { tooltip: 'Add participant' },
};

export const FiresOnAdd: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Add' });
    await userEvent.click(button);
    await expect(args.onAdd).toHaveBeenCalledTimes(1);
  },
};

/** Keyboard path: Tab focuses, Enter activates — native `<button>`. */
export const ActivatesWithKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Add' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onAdd).toHaveBeenCalledTimes(1);
  },
};
