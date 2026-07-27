import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SecretInputField } from '.';

const meta = {
  title: 'shared/ui/SecretInputField',
  component: SecretInputField,
  parameters: { a11y: { test: 'error' } },
  args: { fieldKey: 'apiKey', value: 'sk-1234567890', meta: { label: 'API key' }, onChange: fn() },
} satisfies Meta<typeof SecretInputField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { value: undefined },
};

export const Required: Story = {
  args: { meta: { label: 'API key', isRequired: true } },
};

export const RequiredAndEmpty: Story = {
  args: { value: undefined, meta: { label: 'API key', isRequired: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('API key')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithDescription: Story = {
  args: { meta: { label: 'API key', description: 'Used to authenticate requests to this tool.' } },
};

export const Disabled: Story = {
  args: { meta: { label: 'API key', disabled: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('API key')).toBeDisabled();
  },
};

export const RevealsOnClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Show value' }));
    await expect(canvas.getByLabelText('API key')).toHaveAttribute('type', 'text');
  },
};
