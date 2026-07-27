import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { CommonNumberField } from '.';

const meta = {
  title: 'shared/ui/CommonNumberField',
  component: CommonNumberField,
  parameters: { a11y: { test: 'error' } },
  args: { fieldKey: 'count', value: 5, meta: { label: 'Count' }, fieldType: 'integer', onChange: fn() },
} satisfies Meta<typeof CommonNumberField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FloatField: Story = {
  args: { fieldKey: 'ratio', value: 1.5, meta: { label: 'Ratio' }, fieldType: 'number' },
};

export const Required: Story = {
  args: { meta: { label: 'Count', isRequired: true } },
};

export const WithDescription: Story = {
  args: { meta: { label: 'Count', description: 'How many items to process at once.' } },
};

export const Invalid: Story = {
  args: { value: 100, property: { maximum: 10 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Value must be at most 10')).toBeInTheDocument();
  },
};

export const Disabled: Story = {
  args: { meta: { label: 'Count', disabled: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox')).toBeDisabled();
  },
};

export const Slider: Story = {
  args: { fieldKey: 'volume', value: 5, meta: { label: 'Volume' }, minFieldValue: 0, maxFieldValue: 10 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('slider')).toHaveAttribute('aria-valuenow', '5');
  },
};

export const SliderMovesOnArrowKey: Story = {
  args: { fieldKey: 'volume', value: 5, meta: { label: 'Volume' }, minFieldValue: 0, maxFieldValue: 10 },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByRole('slider');
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(args.onChange).toHaveBeenCalledWith('volume', 6);
  },
};
