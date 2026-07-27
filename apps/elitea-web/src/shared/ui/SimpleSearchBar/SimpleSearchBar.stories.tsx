import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SimpleSearchBar } from '.';

const meta = {
  title: 'shared/ui/input/SimpleSearchBar',
  component: SimpleSearchBar,
  parameters: { a11y: { test: 'error' } },
  args: { value: '', onChange: fn() },
} satisfies Meta<typeof SimpleSearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithValue: Story = {
  args: { value: 'agents' },
};

export const CustomPlaceholder: Story = {
  args: { placeholder: 'Find a tool or agent' },
};

/** A controlled, interactive render — types and asserts the debounced onChange fires. */
export const Controlled: Story = {
  render: (args) => {
    function ControlledSearchBar() {
      const [value, setValue] = useState('');
      return (
        <SimpleSearchBar
          {...args}
          value={value}
          onChange={(next) => {
            setValue(next);
            args.onChange(next);
          }}
          debounceMs={0}
        />
      );
    }
    return <ControlledSearchBar />;
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText('Search...');
    await userEvent.type(input, 'tool');
    await expect(input).toHaveValue('tool');
    await expect(args.onChange).toHaveBeenCalledWith('tool');
  },
};

export const ClearsOnEscape: Story = {
  args: { value: 'agents' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByDisplayValue('agents');
    input.focus();
    await userEvent.keyboard('{Escape}');
    await expect(args.onChange).toHaveBeenCalledWith('');
  },
};
