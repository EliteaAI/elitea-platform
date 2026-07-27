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
 * Stubs `navigator.clipboard.writeText` for the duration of this click,
 * same testing philosophy as `CopyToClipboardButton.test.tsx`'s jsdom
 * project (which reads the outcome off `@testing-library/user-event`'s own
 * clipboard stub) — just implemented by hand, since this play function runs
 * in a real browser, not jsdom, so that stub isn't available here. A
 * granted Playwright context permission alone was not sufficient in CI: a
 * headless Linux runner's sandbox commonly has no OS-level clipboard at all
 * (no X server / clipboard daemon), which no page-level permission can work
 * around. Without this stub, the real (environment-dependent) Clipboard API
 * rejects, and `shared/lib/clipboard.ts`'s `handleCopy` — deliberately,
 * correctly, per that file's own doc comment (a preserved old-app quirk,
 * N4) — fires an unhandled, unawaited retry on total failure, which fails
 * the whole Storybook test run regardless of what this specific test
 * asserts. The `onCopied` callback-vs-toast-hook contract is the
 * `.test.tsx`'s job; this story only proves the click reaches the button
 * without throwing.
 */
export const CopiesOnClick: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: args.value });
    const originalWriteText: typeof navigator.clipboard.writeText = navigator.clipboard.writeText.bind(
      navigator.clipboard,
    );
    navigator.clipboard.writeText = () => Promise.resolve();
    try {
      await userEvent.click(button);
      await expect(button).toBeInTheDocument();
    } finally {
      navigator.clipboard.writeText = originalWriteText;
    }
  },
};
