import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { RadioButtonGroup } from '.';

const ITEMS = [
  { value: 'a', label: 'Option A', description: 'The first option.' },
  { value: 'b', label: 'Option B', info: 'Why you might pick B.' },
  { value: 'c', label: 'Option C', disabled: true },
];

const meta = {
  title: 'shared/ui/RadioButtonGroup',
  component: RadioButtonGroup,
  parameters: { a11y: { test: 'error' } },
  args: {
    items: ITEMS,
    onChange: fn(),
    'aria-label': 'Choose an option',
  },
} satisfies Meta<typeof RadioButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithSelection: Story = {
  args: { value: 'b' },
};

export const WrapsRows: Story = {
  args: { wrapRow: true },
};

export const AllDisabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: /^Option A/ })).toBeDisabled();
  },
};

export const SelectsOnClick: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: /^Option A/ }));
    await expect(args.onChange).toHaveBeenCalledWith('a');
  },
};

/** Keyboard path: Tab focuses the group, arrow keys move the roving selection. */
export const NavigatesWithArrowKeys: Story = {
  args: { value: 'a' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole('radio', { name: /^Option A/ });
    first.focus();
    await expect(first).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(args.onChange).toHaveBeenCalledWith('b');
  },
};
