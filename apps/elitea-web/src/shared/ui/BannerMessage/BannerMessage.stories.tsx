import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { BannerMessage } from '.';

const meta = {
  title: 'shared/ui/BannerMessage',
  component: BannerMessage,
  parameters: { a11y: { test: 'error' } },
  args: { message: 'This credential has not been verified against the provider.' },
} satisfies Meta<typeof BannerMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Warning: Story = {
  args: { variant: 'warning' },
};

export const Error: Story = {
  args: { variant: 'error' },
};

export const Info: Story = {
  args: { variant: 'info' },
};

/** Keyboard path: focus, then toggle expansion with Enter, matching R-C1. */
export const ExpandsOnKeyboardActivation: Story = {
  args: { variant: 'warning' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const banner = canvas.getByRole('button');
    await expect(banner).toHaveAttribute('aria-expanded', 'false');

    banner.focus();
    await expect(banner).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await expect(banner).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard(' ');
    await expect(banner).toHaveAttribute('aria-expanded', 'false');
  },
};

export const ExpandsOnClick: Story = {
  args: { variant: 'warning' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const banner = canvas.getByRole('button');
    await userEvent.click(banner);
    await expect(banner).toHaveAttribute('aria-expanded', 'true');
  },
};
