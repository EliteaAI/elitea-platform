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
    // Real Clipboard API reads/writes need a permission grant this
    // Storybook/Playwright harness does not set up — the actual
    // copy-succeeds behaviour is covered in
    // `CommonStringField.test.tsx` (jsdom, via `@testing-library/
    // user-event`'s own clipboard stub, which needs no such grant). This
    // play function only proves the button renders and is clickable
    // without throwing.
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Copy to clipboard' }));
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
