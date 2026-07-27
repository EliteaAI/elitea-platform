import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { StyledAccordionDetails } from '.';

const meta = {
  title: 'shared/ui/StyledAccordionDetails',
  component: StyledAccordionDetails,
  parameters: { a11y: { test: 'error' } },
  args: { children: 'Panel body content, indented under the summary title.' },
} satisfies Meta<typeof StyledAccordionDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Panel body content, indented under the summary title.')).toBeInTheDocument();
  },
};
