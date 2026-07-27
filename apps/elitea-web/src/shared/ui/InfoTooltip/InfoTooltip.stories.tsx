import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { InfoTooltip } from '.';

const meta = {
  title: 'shared/ui/InfoTooltip',
  component: InfoTooltip,
  parameters: { a11y: { test: 'error' } },
  args: { title: 'More information about this field.' },
} satisfies Meta<typeof InfoTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button')).toBeInTheDocument();
  },
};

export const AsLink: Story = {
  args: { href: 'https://example.com/docs' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link')).toBeInTheDocument();
  },
};

export const RichTitle: Story = {
  args: {
    title: (
      <span>
        Rich <strong>markup</strong> title
      </span>
    ),
  },
};
