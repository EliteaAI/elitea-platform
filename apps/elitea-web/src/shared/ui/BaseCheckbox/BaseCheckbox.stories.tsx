import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { BaseCheckbox } from '.';

const meta = {
  title: 'shared/ui/BaseCheckbox',
  component: BaseCheckbox,
  parameters: { a11y: { test: 'error' } },
  args: { 'aria-label': 'Select item', onChange: fn() },
} satisfies Meta<typeof BaseCheckbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};

export const Checked: Story = {
  args: { checked: true },
};

// This story used to disable `aria-conditional-attr`, on the grounds that the
// `aria-checked="mixed"` / native-`checked=false` mismatch was upstream MUI
// behaviour "not something this wrapper sets or can change". That was wrong on
// the second half: the wrapper CAN set the native `indeterminate` DOM property,
// which is both what screen readers announce and what makes MUI's
// `aria-checked="mixed"` truthful, and it now does (BaseCheckbox.tsx).
//
// The exception is therefore gone rather than re-justified — a disabled rule
// that has stopped being necessary is a gate quietly covering for a defect. It
// went unnoticed because the only call site that renders an indeterminate
// checkbox, the admin permission matrix's group row, had no data to render it
// with until issue #246 seeded the first default-mode grant.
export const Indeterminate: Story = {
  args: { indeterminate: true },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('checkbox')).toBeDisabled();
  },
};

export const RadioMode: Story = {
  args: { mode: 'radio' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio')).toBeInTheDocument();
  },
};

/** Keyboard path: Tab focuses, Space toggles — native checkbox semantics. */
export const TogglesWithSpace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const checkbox = canvas.getByRole('checkbox');
    await userEvent.tab();
    await expect(checkbox).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(args.onChange).toHaveBeenCalledTimes(1);
  },
};
