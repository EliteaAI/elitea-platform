import Box from '@mui/material/Box';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { EllipsisLabelWithTooltip } from '.';

const meta = {
  title: 'shared/ui/label/EllipsisLabelWithTooltip',
  component: EllipsisLabelWithTooltip,
  parameters: { a11y: { test: 'error' } },
  args: { label: 'A reasonably short label' },
  decorators: [
    (Story) => (
      <Box sx={{ width: 160 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof EllipsisLabelWithTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fits: Story = {};

export const Truncated: Story = {
  args: { label: 'This label is far too long to fit in the available width and gets truncated' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const label = canvas.getByText(/This label is far too long/);
    await userEvent.hover(label);
    await waitFor(
      async () => {
        await expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
      },
      { timeout: 3000 },
    );
  },
};

export const CustomVariant: Story = {
  args: { label: 'Small variant label', variant: 'labelSmall' },
};
