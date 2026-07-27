import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import type { TabGroupButtonItem } from '.';
import { TabButtonItem } from '.';

const item: TabGroupButtonItem = { value: 'list', label: 'List' };

/**
 * `TabButtonItem` renders a `<ToggleButton>`, valid markup only inside a
 * `<ToggleButtonGroup>` (a bare toggle button at the story root would fail
 * `aria-required-parent` in the a11y scan) — every story wraps it the same
 * way `TabGroupButton` actually renders it.
 */
const meta = {
  title: 'shared/ui/TabButtonItem',
  component: TabButtonItem,
  parameters: { a11y: { test: 'error' } },
  args: { item },
  decorators: [
    (Story) => (
      <ToggleButtonGroup
        value="list"
        exclusive
      >
        <Story />
      </ToggleButtonGroup>
    ),
  ],
} satisfies Meta<typeof TabButtonItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'List' })).toBeInTheDocument();
  },
};

export const IconOnlyGetsAccessibleNameFromTooltip: Story = {
  args: { item: { value: 'grid', tooltip: 'Grid view', icon: <span data-testid="icon" /> } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Grid view' })).toBeInTheDocument();
  },
};

export const Disabled: Story = {
  args: { item: { ...item, disabled: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'List' })).toBeDisabled();
  },
};

export const TooltipDisabled: Story = {
  args: { disableTooltip: true },
};
