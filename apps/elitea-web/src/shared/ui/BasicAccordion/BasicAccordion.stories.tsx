import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { BasicAccordion, type AccordionItem } from '.';

const ITEMS: AccordionItem[] = [
  { title: 'General', content: 'General settings go here.' },
  { title: 'Advanced', content: 'Advanced settings go here.' },
];

const meta = {
  title: 'shared/ui/BasicAccordion',
  component: BasicAccordion,
  parameters: { a11y: { test: 'error' } },
  args: { items: ITEMS },
} satisfies Meta<typeof BasicAccordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('General settings go here.')).toBeVisible();
    await expect(canvas.getByText('Advanced settings go here.')).toBeVisible();
  },
};

export const CollapsedByDefault: Story = {
  args: { defaultExpanded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('General settings go here.')).not.toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'General' }));
    await expect(canvas.getByText('General settings go here.')).toBeVisible();
  },
};

export const RightMode: Story = {
  args: { showMode: 'right' },
};

export const NotUppercase: Story = {
  args: { uppercase: false },
};

export const WithSummaryAction: Story = {
  args: {
    items: [
      {
        title: 'With an action',
        content: 'Body content.',
        summaryAction: <span>Extra</span>,
      },
    ],
  },
};
