import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { AnimatedLoadingText } from '.';

const meta = {
  title: 'shared/ui/AnimatedLoadingText',
  component: AnimatedLoadingText,
  parameters: { a11y: { test: 'error' } },
  args: { text: 'Thinking' },
} satisfies Meta<typeof AnimatedLoadingText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const char of 'Thinking') {
      await expect(canvas.getAllByText(char).length).toBeGreaterThan(0);
    }
  },
};
