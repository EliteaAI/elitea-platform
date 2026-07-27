import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { FileReaderInput } from '.';

const meta = {
  title: 'shared/ui/input/FileReaderInput',
  component: FileReaderInput,
  parameters: { a11y: { test: 'error' } },
  args: { label: 'Context', value: '', onChange: fn() },
} satisfies Meta<typeof FileReaderInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithValue: Story = {
  args: { value: 'Existing context content.' },
};

export const RestrictedToJsonAndYaml: Story = {
  args: { file: { acceptExtensions: ['json', 'yaml', 'yml'] } },
};

export const AttachButtonIsKeyboardReachable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Attach a file' });
    await userEvent.tab();
    await userEvent.tab();
    await expect(button).toHaveFocus();
  },
};

/** A controlled, interactive render — verifies typed edits round-trip through onChange. */
export const Controlled: Story = {
  render: (args) => {
    function ControlledFileReaderInput() {
      const [value, setValue] = useState(args.value);
      return (
        <FileReaderInput
          {...args}
          value={value}
          onChange={(next) => {
            setValue(next);
            args.onChange(next);
          }}
        />
      );
    }
    return <ControlledFileReaderInput />;
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText('Context');
    await userEvent.type(field, 'typed');
    await expect(field).toHaveValue('typed');
    await expect(args.onChange).toHaveBeenCalled();
  },
};
