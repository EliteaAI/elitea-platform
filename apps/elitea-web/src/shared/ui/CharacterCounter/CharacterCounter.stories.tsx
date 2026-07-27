import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { CharacterCounter } from '.';

const meta = {
  title: 'shared/ui/CharacterCounter',
  component: CharacterCounter,
  parameters: { a11y: { test: 'error' } },
  args: { value: 'hello', maxLength: 20 },
} satisfies Meta<typeof CharacterCounter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('15 characters left')).toBeInTheDocument();
  },
};

export const AtLimit: Story = {
  args: { value: 'exactly twenty chars', maxLength: 'exactly twenty chars'.length },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/MAXIMUM character limit/)).toBeInTheDocument();
  },
};
