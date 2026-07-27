import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';

import { InfoLabelWithTooltip } from '.';

const meta = {
  title: 'shared/ui/label/InfoLabelWithTooltip',
  component: InfoLabelWithTooltip,
  parameters: { a11y: { test: 'error' } },
  args: { label: 'Field label' },
} satisfies Meta<typeof InfoLabelWithTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlainLabel: Story = {};

export const Required: Story = {
  args: { required: true },
};

export const WithTooltip: Story = {
  args: { tooltip: 'Extra detail shown on hover/focus of the info icon' },
  play: async ({ canvasElement }) => {
    const icon = canvasElement.querySelector('svg');
    await expect(icon).not.toBeNull();
    await userEvent.hover(icon as Element);
    await waitFor(
      async () => {
        await expect(document.body).toHaveTextContent('Extra detail shown on hover/focus of the info icon');
      },
      { timeout: 3000 },
    );
  },
};

export const Inline: Story = {
  args: { inline: true, tooltip: 'Shown inline inside a parent Typography' },
};

export const CustomVariant: Story = {
  args: { variant: 'headingSmall' },
};
