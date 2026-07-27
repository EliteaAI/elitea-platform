import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';

import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { AnyOfPatternField } from '.';

installCodeMirrorTestPolyfills();

const meta = {
  title: 'shared/ui/AnyOfPatternField',
  component: AnyOfPatternField,
  parameters: { a11y: { test: 'error' } },
  args: { fieldKey: 'values', value: ['alpha', 42], meta: { label: 'Values' }, onChange: fn() },
} satisfies Meta<typeof AnyOfPatternField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { value: undefined },
};

export const Required: Story = {
  args: { meta: { label: 'Values', isRequired: true } },
};

export const WithDescription: Story = {
  args: { meta: { label: 'Values', description: 'Values matching any of the allowed patterns.' } },
};

export const ReadOnly: Story = {
  args: { meta: { label: 'Values', disabled: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox')).toHaveAttribute('aria-readonly', 'true');
  },
};
