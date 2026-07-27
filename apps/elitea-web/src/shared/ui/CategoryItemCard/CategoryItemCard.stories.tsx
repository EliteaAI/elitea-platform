import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';

import { CategoryItemCard } from '.';

const meta = {
  title: 'shared/ui/CategoryItemCard',
  component: CategoryItemCard,
  parameters: { a11y: { test: 'error' } },
  args: { label: 'GitHub Toolkit', onClick: fn() },
} satisfies Meta<typeof CategoryItemCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'GitHub Toolkit' })).toBeInTheDocument();
  },
};

export const WithIcon: Story = {
  args: {
    icon: (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          fill="currentColor"
        />
      </svg>
    ),
  },
};

export const LongLabel: Story = {
  args: { label: 'A very long tool name that does not fit the fixed-width card' },
};
