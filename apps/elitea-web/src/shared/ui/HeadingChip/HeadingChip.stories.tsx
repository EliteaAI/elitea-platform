import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { HeadingChip } from '.';

const meta = {
  title: 'shared/ui/HeadingChip',
  component: HeadingChip,
  parameters: { a11y: { test: 'error' } },
  args: { label: 'Recent tools' },
} satisfies Meta<typeof HeadingChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Recent tools')).toBeInTheDocument();
  },
};

export const LongLabel: Story = {
  args: { label: 'A much longer section heading label' },
};
