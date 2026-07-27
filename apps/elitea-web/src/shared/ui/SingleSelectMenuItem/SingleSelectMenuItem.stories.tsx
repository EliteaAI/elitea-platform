import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import Menu from '@mui/material/Menu';

import type { SingleSelectOption } from '.';
import { SingleSelectMenuItem } from '.';

const option: SingleSelectOption = { value: 'claude', label: 'Claude' };

/**
 * `SingleSelectMenuItem` is a `<MenuItem>` and is only ever valid markup as
 * a child of a `<Menu>`/`<MenuList>` (a bare `<li>` at the story root would
 * fail `aria-required-parent` in the a11y scan) — every story wraps it in
 * an always-open `Menu`, matching how `SingleSelect` actually renders it.
 */
const meta = {
  title: 'shared/ui/SingleSelectMenuItem',
  component: SingleSelectMenuItem,
  parameters: { a11y: { test: 'error' } },
  args: {
    option,
    value: option.value,
    isSelected: false,
  },
  decorators: [
    (Story) => (
      <Menu
        open
        anchorReference="none"
      >
        <Story />
      </Menu>
    ),
  ],
} satisfies Meta<typeof SingleSelectMenuItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole('menuitem', { name: 'Claude' })).toBeInTheDocument();
  },
};

export const Selected: Story = {
  args: { isSelected: true },
};

export const WithIcon: Story = {
  args: { option: { ...option, icon: <span data-testid="option-icon" /> } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByTestId('option-icon')).toBeInTheDocument();
  },
};

export const WithDescription: Story = {
  args: { option: { ...option, description: 'Anthropic — 200k context' } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText('Anthropic — 200k context')).toBeInTheDocument();
  },
};

export const Disabled: Story = {
  args: { option: { ...option, disabled: true } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole('menuitem', { name: 'Claude' })).toHaveAttribute('aria-disabled', 'true');
  },
};
