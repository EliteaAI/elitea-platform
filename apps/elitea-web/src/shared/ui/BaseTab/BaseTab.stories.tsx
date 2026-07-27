import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';

import { BaseTabs } from '../BaseTabs';
import { BaseTab } from '.';

const meta = {
  title: 'shared/ui/BaseTab',
  component: BaseTab,
  parameters: { a11y: { test: 'error' } },
  decorators: [
    (Story) => (
      <BaseTabs
        value={0}
        onChange={fn()}
        aria-label="Sections"
      >
        <Story />
      </BaseTabs>
    ),
  ],
} satisfies Meta<typeof BaseTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: 'Overview' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
  },
};

export const Disabled: Story = {
  args: { label: 'Locked', disabled: true },
};
