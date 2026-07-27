import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { TooltipMarkdownContent } from '.';

const meta = {
  title: 'shared/ui/TooltipMarkdownContent',
  component: TooltipMarkdownContent,
  parameters: { a11y: { test: 'error' } },
  args: { children: 'A tooltip hint with **bold** and a short list:\n\n- one\n- two' },
} satisfies Meta<typeof TooltipMarkdownContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('bold')).toBeInTheDocument();
  },
};
