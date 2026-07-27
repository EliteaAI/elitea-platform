import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SecretManagementInput } from '.';

const meta = {
  title: 'shared/ui/secret-field/SecretManagementInput',
  component: SecretManagementInput,
  parameters: { a11y: { test: 'error' } },
  args: {
    value: '',
    label: 'API Key',
    name: 'api_key',
    onChange: fn(),
  },
} satisfies Meta<typeof SecretManagementInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('API Key', { exact: false });
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveAttribute('name', 'api_key');
  },
};

export const WithSecretPicker: Story = {
  args: {
    value: '{{secret.prod_api_key}}',
    secrets: {
      options: [
        { label: 'Prod API key', value: '{{secret.prod_api_key}}' },
        { label: 'Staging API key', value: '{{secret.staging_api_key}}' },
      ],
    },
  },
};

/** A realistic controlled usage: state lives with the caller, exactly as the props/callbacks contract expects. */
export const Controlled: Story = {
  render: (args) => {
    function ControlledInput() {
      const [value, setValue] = useState('');
      return (
        <SecretManagementInput
          {...args}
          value={value}
          onChange={setValue}
        />
      );
    }
    return <ControlledInput />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('API Key', { exact: false });
    await userEvent.type(input, 'sk-live-123');
    await expect(input).toHaveValue('sk-live-123');
  },
};
