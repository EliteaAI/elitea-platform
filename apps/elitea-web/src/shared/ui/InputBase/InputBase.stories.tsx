import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { InputBase } from '.';

const meta = {
  title: 'shared/ui/input/InputBase',
  component: InputBase,
  parameters: { a11y: { test: 'error' } },
  args: { label: 'Field label', onChange: fn() },
} satisfies Meta<typeof InputBase>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { value: '' },
};

export const WithTooltipDescription: Story = {
  args: { value: '', tooltipDescription: 'Extra context shown next to the label' },
};

export const Multiline: Story = {
  args: {
    value: 'Line one\nLine two',
    expand: { minRows: 3, maxRows: 8 },
  },
};

export const WithActionsToolbarForced: Story = {
  args: {
    value: 'Copy me',
    actions: { enabled: true, forceShow: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument();
  },
};

export const ExpandToggle: Story = {
  args: {
    value: 'Row one\nRow two\nRow three\nRow four\nRow five',
    expand: { minRows: 2, maxRows: 6, collapsed: true },
    actions: { enabled: true, forceShow: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const expandBtn = canvas.getByRole('button', { name: 'Expand field' });
    await userEvent.click(expandBtn);
    await expect(canvas.getByRole('button', { name: 'Collapse field' })).toBeInTheDocument();
  },
};

/** A controlled, interactive render — verifies the field actually accepts typed input. */
export const Controlled: Story = {
  render: (args) => {
    function ControlledInputBase() {
      const [value, setValue] = useState('');
      return (
        <InputBase
          {...args}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      );
    }
    return <ControlledInputBase />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Field label');
    await userEvent.type(input, 'typed text');
    await expect(input).toHaveValue('typed text');
  },
};
