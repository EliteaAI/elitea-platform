import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { CommonBooleanField } from '.';

const meta = {
  title: 'shared/ui/CommonBooleanField',
  component: CommonBooleanField,
  parameters: { a11y: { test: 'error' } },
  args: { fieldKey: 'enabled', value: false, meta: { label: 'Enabled' }, onChange: fn() },
} satisfies Meta<typeof CommonBooleanField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};

export const Checked: Story = {
  args: { value: true },
};

export const Required: Story = {
  args: { meta: { label: 'Enabled', isRequired: true } },
};

export const WithDescription: Story = {
  args: { meta: { label: 'Enabled', description: 'Turns the feature on for this project.' } },
};

export const Disabled: Story = {
  args: { meta: { label: 'Enabled', disabled: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('checkbox')).toBeDisabled();
  },
};

export const TogglesOnClick: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('checkbox'));
    await expect(args.onChange).toHaveBeenCalledWith('enabled', true);
  },
};
