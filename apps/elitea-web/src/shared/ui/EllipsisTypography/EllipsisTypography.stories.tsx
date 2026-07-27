import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { EllipsisTypography } from '.';

const meta = {
  title: 'shared/ui/EllipsisTypography',
  component: EllipsisTypography,
  parameters: { a11y: { test: 'error' } },
} satisfies Meta<typeof EllipsisTypography>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: 'A short label' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('A short label')).toBeInTheDocument();
  },
};

export const Truncated: Story = {
  args: {
    children: 'A very long piece of text that would overflow a narrow column and get truncated',
  },
  decorators: [
    (Story) => (
      <div style={{ width: '8rem' }}>
        <Story />
      </div>
    ),
  ],
};
