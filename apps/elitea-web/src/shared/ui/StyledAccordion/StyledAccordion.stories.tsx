import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { StyledAccordion } from '.';

const meta = {
  title: 'shared/ui/StyledAccordion',
  component: StyledAccordion,
  parameters: { a11y: { test: 'error' } },
  args: {
    children: [
      <AccordionSummary key="summary">Section title</AccordionSummary>,
      <AccordionDetails key="details">Section body content.</AccordionDetails>,
    ],
  },
} satisfies Meta<typeof StyledAccordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Section title' })).toBeInTheDocument();
  },
};

export const DefaultExpanded: Story = {
  args: { defaultExpanded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Section body content.')).toBeVisible();
  },
};

export const ExpandsOnClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Section title' }));
    await expect(canvas.getByRole('button', { name: 'Section title' })).toHaveAttribute('aria-expanded', 'true');
  },
};
