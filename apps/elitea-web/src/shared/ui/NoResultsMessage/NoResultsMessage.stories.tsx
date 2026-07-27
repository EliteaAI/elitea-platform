import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { NoResultsMessage } from '.';

const meta = {
  title: 'shared/ui/NoResultsMessage',
  component: NoResultsMessage,
  parameters: { a11y: { test: 'error' } },
  args: { title: 'No tools found', description: 'Try a different search term.' },
} satisfies Meta<typeof NoResultsMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No tools found')).toBeInTheDocument();
    await expect(canvas.getByText('Try a different search term.')).toBeInTheDocument();
  },
};
