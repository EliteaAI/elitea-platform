import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { BaseSwitch } from '.';

const meta = {
  title: 'shared/ui/BaseSwitch',
  component: BaseSwitch,
  parameters: { a11y: { test: 'error' } },
  args: { 'aria-label': 'Enable notifications', onChange: fn() },
} satisfies Meta<typeof BaseSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const On: Story = {
  args: { checked: true },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('switch')).toBeDisabled();
  },
};

export const MediumSize: Story = {
  args: { size: 'medium' },
};

/** Keyboard path: Tab focuses, Space toggles — MUI's `role="switch"` input. */
export const TogglesWithSpace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('switch');
    await userEvent.tab();
    await expect(toggle).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(args.onChange).toHaveBeenCalledTimes(1);
  },
};
