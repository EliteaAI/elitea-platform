import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { CommonArrayField } from '.';

installCodeMirrorTestPolyfills();

const meta = {
  title: 'shared/ui/CommonArrayField',
  component: CommonArrayField,
  parameters: { a11y: { test: 'error' } },
  args: { fieldKey: 'tags', value: ['alpha', 'beta'], meta: { label: 'Tags' }, onChange: fn() },
} satisfies Meta<typeof CommonArrayField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const JsonEditor: Story = {};

export const JsonEditorEmpty: Story = {
  args: { value: undefined },
};

export const EnumMultiSelect: Story = {
  args: {
    value: ['red'],
    meta: { label: 'Colors' },
    property: { items: { enum: ['red', 'green', 'blue'] } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('combobox'));
    // MUI's `Select` menu renders through a portal appended to
    // `document.body`, outside `canvasElement` — the open listbox's
    // options have to be queried there, not through `canvas`.
    await expect(within(document.body).getByRole('option', { name: /red/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};

export const Disabled: Story = {
  args: { meta: { label: 'Tags', disabled: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox')).toHaveAttribute('aria-readonly', 'true');
  },
};
