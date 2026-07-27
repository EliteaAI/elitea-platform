import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import Menu from '@mui/material/Menu';

import type { SingleSelectOption } from '../SingleSelectMenuItem';
import { SingleSelectDropdown } from '.';

const option: SingleSelectOption = { value: 'claude', label: 'Claude' };

/** Same "only valid as a `Menu` child" constraint as `SingleSelectMenuItem` — see that story file's note. */
const meta = {
  title: 'shared/ui/SingleSelectDropdown',
  component: SingleSelectDropdown,
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
} satisfies Meta<typeof SingleSelectDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const row = body.getByRole('menuitem', { name: 'Claude' });
    await expect(row).toBeInTheDocument();
    await expect(row).toHaveAttribute('data-testid', 'select-option-claude');
  },
};

export const Selected: Story = {
  args: { isSelected: true },
};
