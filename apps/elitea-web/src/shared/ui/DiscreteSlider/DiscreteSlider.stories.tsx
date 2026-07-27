import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { DiscreteSliderLevel } from '.';
import { DiscreteSlider } from '.';

const levels: DiscreteSliderLevel[] = [
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
];

// `label` is deliberately NOT a `meta.args` default — see the same note in
// SingleSelect.stories.tsx (`exactOptionalPropertyTypes` forbids a story
// setting an optional key back to `undefined`).
const meta = {
  title: 'shared/ui/DiscreteSlider',
  component: DiscreteSlider,
  parameters: { a11y: { test: 'error' } },
  args: {
    value: 2,
    max: 3,
    onChange: fn(),
  },
} satisfies Meta<typeof DiscreteSlider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: 'Creativity' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('slider', { name: 'Creativity' })).toBeInTheDocument();
  },
};

export const WithLevelLabels: Story = {
  args: { label: 'Creativity', levels, showLabels: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Low')).toBeInTheDocument();
    await expect(canvas.getByText('High')).toBeInTheDocument();
    // "Medium" (the current value, 2) renders twice: once as its mark
    // label, once in the always-in-DOM drag value bubble.
    await expect(canvas.getAllByText('Medium').length).toBeGreaterThanOrEqual(1);
  },
};

/** Keyboard path: ArrowRight increases the value by one step. */
export const KeyboardAdjustment: Story = {
  args: { label: 'Creativity' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByRole('slider', { name: 'Creativity' });
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(args.onChange).toHaveBeenCalledWith(3);
  },
};

export const Disabled: Story = {
  args: { label: 'Creativity', disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('slider', { name: 'Creativity' })).toBeDisabled();
  },
};

export const WithTooltip: Story = {
  args: { label: 'Creativity', labelTooltip: 'Higher values produce more varied output' },
};

export const WithoutLabel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('slider')).toBeInTheDocument();
  },
};
