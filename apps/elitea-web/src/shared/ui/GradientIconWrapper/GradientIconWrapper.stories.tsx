import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { GradientIconWrapper } from '.';

const meta = {
  title: 'shared/ui/GradientIconWrapper',
  component: GradientIconWrapper,
  parameters: { a11y: { test: 'error' } },
  args: { children: <span aria-hidden="true">AI</span> },
} satisfies Meta<typeof GradientIconWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('AI')).toBeInTheDocument();
  },
};

export const Large: Story = {
  args: { size: '4rem' },
};
