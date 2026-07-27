import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { BaseBtn } from '.';

const meta = {
  title: 'shared/ui/BaseBtn',
  component: BaseBtn,
  parameters: { a11y: { test: 'error' } },
  args: { children: 'Save', onClick: fn() },
} satisfies Meta<typeof BaseBtn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Contained: Story = {
  args: { variant: 'contained' },
};

export const Secondary: Story = {
  args: { variant: 'secondary' },
};

export const Special: Story = {
  args: { variant: 'special' },
};

export const Disabled: Story = {
  args: { variant: 'contained', disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button')).toBeDisabled();
  },
};

export const Loading: Story = {
  args: { variant: 'contained', loading: true },
};

/** Keyboard path: Tab focuses, Enter/Space activate — native `<button>`. */
export const ActivatesWithKeyboard: Story = {
  args: { variant: 'contained' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button');
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(' ');
    await expect(args.onClick).toHaveBeenCalledTimes(2);
  },
};
