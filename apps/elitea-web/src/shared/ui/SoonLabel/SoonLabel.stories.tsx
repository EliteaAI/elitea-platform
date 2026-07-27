import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { SoonLabel } from '.';

const meta = {
  title: 'shared/ui/SoonLabel',
  component: SoonLabel,
  parameters: { a11y: { test: 'error' } },
  args: { text: 'Advanced automations' },
} satisfies Meta<typeof SoonLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Advanced automations')).toBeInTheDocument();
    await expect(canvas.getByText('Soon')).toBeInTheDocument();
  },
};

export const LongLabel: Story = {
  args: { text: 'A considerably longer feature name that still fits the row' },
};
