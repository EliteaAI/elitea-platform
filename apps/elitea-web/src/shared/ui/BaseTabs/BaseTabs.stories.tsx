import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { BaseTab } from '../BaseTab';
import { BaseTabs } from '.';

const meta = {
  title: 'shared/ui/BaseTabs',
  component: BaseTabs,
  parameters: { a11y: { test: 'error' } },
} satisfies Meta<typeof BaseTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <BaseTabs
      {...args}
      value={0}
      onChange={fn()}
      aria-label="Sections"
    >
      <BaseTab label="Overview" />
      <BaseTab label="Settings" />
      <BaseTab label="History" />
    </BaseTabs>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  },
};

export const Disabled: Story = {
  render: (args) => (
    <BaseTabs
      {...args}
      value={0}
      onChange={fn()}
      aria-label="Sections"
    >
      <BaseTab label="Overview" />
      <BaseTab
        label="Locked"
        disabled
      />
    </BaseTabs>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'Locked' })).toBeDisabled();
  },
};

/** Keyboard path: ArrowRight moves focus to the next tab, Enter selects it. */
export const NavigatesWithArrowKeys: Story = {
  render: function Render(args) {
    const [value, setValue] = useState(0);
    return (
      <BaseTabs
        {...args}
        value={value}
        onChange={(_event, next: number) => setValue(next)}
        aria-label="Sections"
      >
        <BaseTab label="Overview" />
        <BaseTab label="Settings" />
      </BaseTabs>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole('tab', { name: 'Overview' });
    first.focus();
    await expect(first).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    const second = canvas.getByRole('tab', { name: 'Settings' });
    await expect(second).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await expect(second).toHaveAttribute('aria-selected', 'true');
  },
};
