import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { CategoryFilter } from '.';

// `title` is deliberately NOT a `meta.args` default — see the same note in
// SingleSelect.stories.tsx (`exactOptionalPropertyTypes` forbids a story
// setting an optional key back to `undefined`).
const meta = {
  title: 'shared/ui/CategoryFilter',
  component: CategoryFilter,
  parameters: { a11y: { test: 'error' } },
  args: {
    searchPlaceholder: 'Search prompts',
    allCategories: ['Writing', 'Coding', 'Research'],
    selectedCategories: [],
    onSelectCategory: fn(),
    onSearchChange: fn(),
    children: <div>Prompt cards go here</div>,
  },
} satisfies Meta<typeof CategoryFilter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: 'Prompt library' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Prompt library')).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Search prompts' })).toBeInTheDocument();
  },
};

export const SelectingACategoryTogglesAriaPressed: Story = {
  args: { title: 'Prompt library' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByText('Writing');
    await expect(chip.closest('[aria-pressed]')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    await expect(args.onSelectCategory).toHaveBeenCalledWith('Writing');
  },
};

export const WithSelectedCategory: Story = {
  args: { title: 'Prompt library', selectedCategories: ['Coding'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByText('Coding');
    await expect(chip.closest('[aria-pressed]')).toHaveAttribute('aria-pressed', 'true');
  },
};

export const SingleCategoryHidesChipRow: Story = {
  args: { title: 'Prompt library', allCategories: ['Writing'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Writing')).not.toBeInTheDocument();
  },
};

export const NoTitle: Story = {};

export const TypingIntoSearch: Story = {
  args: { title: 'Prompt library' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Search prompts' });
    await userEvent.type(input, 'a');
    await expect(args.onSearchChange).toHaveBeenCalled();
  },
};
