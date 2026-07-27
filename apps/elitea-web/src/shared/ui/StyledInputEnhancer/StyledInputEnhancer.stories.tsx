import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { StyledInputEnhancer } from '.';

const meta = {
  title: 'shared/ui/input/StyledInputEnhancer',
  component: StyledInputEnhancer,
  parameters: { a11y: { test: 'error' } },
  args: { label: 'Prompt', value: 'System prompt content goes here.', onChange: fn() },
} satisfies Meta<typeof StyledInputEnhancer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OpensFullScreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Full screen view' }));
    await expect(within(document.body).getByRole('dialog')).toBeInTheDocument();
  },
};

export const CustomTitle: Story = {
  args: { fullScreenTitle: 'Edit the system prompt' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Full screen view' }));
    const dialog = within(document.body).getByRole('dialog');
    await expect(within(dialog).getByText('Edit the system prompt')).toBeInTheDocument();
  },
};
