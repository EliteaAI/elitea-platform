import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { StyledExpandMoreIcon } from '.';

const meta = {
  title: 'shared/ui/StyledExpandMoreIcon',
  component: StyledExpandMoreIcon,
  parameters: { a11y: { test: 'error' } },
} satisfies Meta<typeof StyledExpandMoreIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('svg')).toBeInTheDocument();
  },
};

export const Rotated: Story = {
  args: { sx: { transform: 'rotate(90deg)' } },
};
