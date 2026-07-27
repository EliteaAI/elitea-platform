import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { StyledAccordionSummary } from '.';

const meta = {
  title: 'shared/ui/StyledAccordionSummary',
  component: StyledAccordionSummary,
  parameters: { a11y: { test: 'error' } },
  args: { children: 'Panel title' },
  render: (args) => (
    <Accordion>
      <StyledAccordionSummary {...args} />
      <AccordionDetails>Panel body content.</AccordionDetails>
    </Accordion>
  ),
} satisfies Meta<typeof StyledAccordionSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Panel title' })).toHaveAttribute('aria-expanded', 'false');
  },
};

export const RightMode: Story = {
  args: { showMode: 'right' },
};

export const ExpandsOnClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Panel title' });
    await userEvent.click(button);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText('Panel body content.')).toBeVisible();
  },
};
