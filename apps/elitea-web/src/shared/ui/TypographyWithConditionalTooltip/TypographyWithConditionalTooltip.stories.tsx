import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { TypographyWithConditionalTooltip } from '.';

const meta = {
  title: 'shared/ui/TypographyWithConditionalTooltip',
  component: TypographyWithConditionalTooltip,
  parameters: { a11y: { test: 'error' } },
  args: { title: 'The full, untruncated text', variant: 'bodyMedium' },
} satisfies Meta<typeof TypographyWithConditionalTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: 'Some visible text' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Some visible text')).toBeInTheDocument();
  },
};

export const Truncated: Story = {
  args: {
    children: 'A very long piece of text that would overflow a narrow container and get truncated',
  },
  decorators: [
    (Story) => (
      <div style={{ width: '8rem' }}>
        <Story />
      </div>
    ),
  ],
};
