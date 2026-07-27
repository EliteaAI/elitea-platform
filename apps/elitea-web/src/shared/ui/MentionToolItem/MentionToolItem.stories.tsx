import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { MentionToolItem } from '.';

const meta = {
  title: 'shared/ui/MentionToolItem',
  component: MentionToolItem,
  parameters: { a11y: { test: 'error' } },
  args: { label: 'search_web' },
} satisfies Meta<typeof MentionToolItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { description: 'Searches the web for the given query.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('search_web')).toBeInTheDocument();
    await expect(canvas.getByRole('button')).toBeInTheDocument();
  },
};

export const Highlighted: Story = {
  args: { description: 'Searches the web for the given query.', isHighlighted: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-highlighted="true"]')).not.toBeNull();
  },
};

export const NoDescription: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('search_web')).toBeInTheDocument();
  },
};
