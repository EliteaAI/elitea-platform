import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { TextWithLink } from '.';

const meta = {
  title: 'shared/ui/TextWithLink',
  component: TextWithLink,
  parameters: { a11y: { test: 'error' } },
  args: {
    text: 'Read the',
    linkUrl: 'https://elitea.ai/docs',
    linkText: 'documentation',
    suffix: ' for details.',
  },
} satisfies Meta<typeof TextWithLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const link = canvasElement.querySelector('a');
    await expect(link).toHaveAttribute('href', 'https://elitea.ai/docs');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('target', '_blank');
  },
};
