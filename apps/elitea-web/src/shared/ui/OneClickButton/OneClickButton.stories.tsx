import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, userEvent, within } from 'storybook/test';

import { OneClickButton } from '.';

const meta = {
  title: 'shared/ui/OneClickButton',
  component: OneClickButton,
  parameters: { a11y: { test: 'error' } },
  args: { title: 'Submit', onClick: fn() },
} satisfies Meta<typeof OneClickButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PrimaryColor: Story = {
  args: { color: 'primary' },
};

export const DisablesAfterFirstClick: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Submit' });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
    await expect(button).toBeDisabled();
    // `pointer-events: none` on a disabled MUI button makes `userEvent.click`
    // correctly refuse to simulate a real click; `fireEvent` dispatches the
    // DOM event directly, proving the handler itself is gated by `disabled`.
    await fireEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const StartsDisabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Submit' })).toBeDisabled();
  },
};
