import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import type { CategoryItem } from '../CategoryItemCard';
import { CategorySection } from '.';

const ITEMS: CategoryItem[] = [
  { key: 'github', label: 'GitHub Toolkit' },
  { key: 'jira', label: 'Jira Toolkit' },
  { key: 'slack', label: 'Slack Toolkit' },
];

const meta = {
  title: 'shared/ui/CategorySection',
  component: CategorySection,
  parameters: { a11y: { test: 'error' } },
  args: { category: 'Toolkits', items: ITEMS },
} satisfies Meta<typeof CategorySection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Toolkits')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'GitHub Toolkit' })).toBeInTheDocument();
  },
};

export const HiddenTitle: Story = {
  args: { showCategory: false },
};

export const Empty: Story = {
  args: { items: [], emptyPlaceholder: <span>No toolkits in this category.</span> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No toolkits in this category.')).toBeInTheDocument();
  },
};
