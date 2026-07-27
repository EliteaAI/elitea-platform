import type { ReactNode } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { CategorySection } from '../CategorySection';
import { NoResultsMessage } from '../NoResultsMessage';
import { GroupedCategory } from '.';

const renderCategory = (category: string, items: Parameters<typeof CategorySection>[0]['items']): ReactNode => (
  <CategorySection
    key={category}
    category={category}
    items={items}
  />
);

const meta = {
  title: 'shared/ui/GroupedCategory',
  component: GroupedCategory,
  parameters: { a11y: { test: 'error' } },
  args: {
    allCategories: ['Development', 'Communication'],
    groupedItems: {
      Development: [
        { key: 'github', label: 'GitHub Toolkit' },
        { key: 'gitlab', label: 'GitLab Toolkit' },
      ],
      Communication: [{ key: 'slack', label: 'Slack Toolkit' }],
    },
    renderCategory,
  },
} satisfies Meta<typeof GroupedCategory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Development')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'GitHub Toolkit' })).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status', { name: 'Loading categories' })).toBeInTheDocument();
  },
};

export const NoResults: Story = {
  args: {
    allCategories: ['Development'],
    groupedItems: { Development: [] },
    noResultsSlot: (
      <NoResultsMessage
        title="No toolkits found"
        description="Try a different search term."
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No toolkits found')).toBeInTheDocument();
  },
};
