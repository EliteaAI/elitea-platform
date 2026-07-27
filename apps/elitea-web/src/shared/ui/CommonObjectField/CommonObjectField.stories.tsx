import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';

import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { CommonObjectField } from '.';

installCodeMirrorTestPolyfills();

const meta = {
  title: 'shared/ui/CommonObjectField',
  component: CommonObjectField,
  parameters: { a11y: { test: 'error' } },
  args: { fieldKey: 'config', value: { host: 'localhost', port: 8080 }, meta: { label: 'Config' }, onChange: fn() },
} satisfies Meta<typeof CommonObjectField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { value: undefined },
};

export const Required: Story = {
  args: { meta: { label: 'Config', isRequired: true } },
};

export const WithDescription: Story = {
  args: { meta: { label: 'Config', description: 'Free-form JSON configuration for this tool.' } },
};

export const ReadOnly: Story = {
  args: { meta: { label: 'Config', disabled: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox')).toHaveAttribute('aria-readonly', 'true');
  },
};
