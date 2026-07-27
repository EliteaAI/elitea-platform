import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { CopyToClipboardButton } from '.';

const meta = {
  title: 'shared/ui/CopyToClipboardButton',
  component: CopyToClipboardButton,
  parameters: { a11y: { test: 'error' } },
  args: {
    label: 'API key',
    value: 'sk-elitea-1234567890',
    onCopied: fn(),
  },
} satisfies Meta<typeof CopyToClipboardButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTooltip: Story = {
  args: { tooltip: 'Copy to clipboard' },
};

/**
 * A real `navigator.clipboard.writeText` call needs a clipboard-write
 * permission the headless browser running this story does not reliably
 * grant (unlike `CopyToClipboardButton.test.tsx`'s jsdom project, which
 * reads the outcome back off `@testing-library/user-event`'s own clipboard
 * stub — see that file's doc comment). This story therefore only proves the
 * click reaches the button without throwing; the `onCopied`
 * callback-vs-toast-hook contract is the `.test.tsx`'s job.
 */
export const CopiesOnClick: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: args.value });
    await userEvent.click(button);
    await expect(button).toBeInTheDocument();
  },
};
