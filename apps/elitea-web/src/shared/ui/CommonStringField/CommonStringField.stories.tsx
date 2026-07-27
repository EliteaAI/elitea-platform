import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { CommonStringField } from '.';

installCodeMirrorTestPolyfills();

const meta = {
  title: 'shared/ui/CommonStringField',
  component: CommonStringField,
  parameters: { a11y: { test: 'error' } },
  args: { fieldKey: 'name', value: 'Elitea', meta: { label: 'Name' }, onChange: fn() },
} satisfies Meta<typeof CommonStringField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Required: Story = {
  args: { meta: { label: 'Name', isRequired: true } },
};

export const WithDescription: Story = {
  args: { meta: { label: 'Name', description: 'The display name for this resource.' } },
};

export const WithError: Story = {
  args: { meta: { label: 'Name', error: 'Name is required' } },
};

export const Multiline: Story = {
  args: { value: 'Line one\nLine two', property: { multiline: true } },
};

export const WithClipboardButton: Story = {
  args: { meta: { label: 'API key', clipboard: true } },
  play: async ({ canvasElement }) => {
    // Stubs navigator.clipboard.writeText for the duration of this click,
    // same testing philosophy as `CommonStringField.test.tsx`'s jsdom
    // project (which reads the outcome off `@testing-library/user-event`'s
    // own clipboard stub) — just implemented by hand, since this play
    // function runs in a real browser, not jsdom, so that stub isn't
    // available here. A granted Playwright permission alone was not
    // sufficient in CI: a headless Linux runner's sandbox commonly has no
    // OS-level clipboard at all (no X server / clipboard daemon), which no
    // page-level permission can work around. Without this stub, the real
    // (environment-dependent) Clipboard API rejects, and
    // `shared/lib/clipboard.ts`'s `handleCopy` — deliberately, correctly,
    // per that file's own doc comment (a preserved old-app quirk, N4) —
    // fires an unhandled, unawaited retry on total failure, which fails
    // the whole Storybook test run regardless of what this specific test
    // asserts.
    const canvas = within(canvasElement);
    const originalWriteText: typeof navigator.clipboard.writeText = navigator.clipboard.writeText.bind(
      navigator.clipboard,
    );
    navigator.clipboard.writeText = () => Promise.resolve();
    try {
      await userEvent.click(canvas.getByRole('button', { name: 'Copy to clipboard' }));
    } finally {
      navigator.clipboard.writeText = originalWriteText;
    }
  },
};

export const Disabled: Story = {
  args: { meta: { label: 'Name', disabled: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox')).toBeDisabled();
  },
};

export const EnumDropdown: Story = {
  args: { value: 'a', meta: { label: 'Mode', enumValues: ['a', 'b', 'c'], isRequired: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('combobox')).toBeInTheDocument();
  },
};

export const CodeLanguage: Story = {
  args: { value: 'print(1)', meta: { label: 'Script', codeLanguage: 'python' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox')).toHaveTextContent('print(1)');
  },
};
