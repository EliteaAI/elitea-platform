import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { InputActionsToolbar } from '.';

const meta = {
  title: 'shared/ui/input/InputActionsToolbar',
  component: InputActionsToolbar,
  parameters: { a11y: { test: 'error' } },
  args: { value: 'Some field content', onCopy: fn(), onToggleExpand: fn(), onFullScreen: fn() },
} satisfies Meta<typeof InputActionsToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllActions: Story = {};

export const Empty: Story = {
  args: { value: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Only the full-screen action survives an empty value.
    await expect(canvas.getAllByRole('button')).toHaveLength(1);
  },
};

export const Expanded: Story = {
  args: { isExpanded: true },
};

export const ClickCopy: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Copy to clipboard' }));
    await expect(args.onCopy).toHaveBeenCalledTimes(1);
  },
};
