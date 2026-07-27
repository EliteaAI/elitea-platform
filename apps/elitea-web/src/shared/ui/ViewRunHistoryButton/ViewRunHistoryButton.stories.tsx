import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ViewRunHistoryButton } from '.';

const meta = {
  title: 'shared/ui/ViewRunHistoryButton',
  component: ViewRunHistoryButton,
  parameters: { a11y: { test: 'error' } },
  args: { onShowHistory: fn() },
} satisfies Meta<typeof ViewRunHistoryButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FiresOnShowHistory: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'View run history' });
    await userEvent.click(button);
    await expect(args.onShowHistory).toHaveBeenCalledTimes(1);
  },
};

export const CarriesTestHooks: Story = {
  args: { dataTour: 'run-history-target' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId('pipeline-history-tab');
    await expect(button).toHaveAttribute('data-tour', 'run-history-target');
  },
};
