import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';

import type { MentionTool } from '.';
import { MentionToolList } from '.';

const TOOLS: MentionTool[] = [
  { name: 'search_web', description: 'Searches the web for the given query.' },
  { name: 'read_file', description: 'Reads the contents of a file from the repository.' },
  { name: 'create_issue', description: 'Creates a new issue in the configured tracker.' },
];

const meta = {
  title: 'shared/ui/MentionToolList',
  component: MentionToolList,
  parameters: { a11y: { test: 'error' } },
  args: {
    tools: TOOLS,
    toolkitName: 'GitHub',
    onSelectTool: fn(),
    highlightedIndex: 0,
  },
} satisfies Meta<typeof MentionToolList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/GitHub/)).toBeInTheDocument();
    await expect(canvas.getAllByRole('button')).toHaveLength(3);
  },
};

export const NoHighlight: Story = {
  args: { highlightedIndex: -1 },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-highlighted="true"]')).toBeNull();
  },
};

export const Empty: Story = {
  args: { tools: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/GitHub/)).toBeInTheDocument();
    await expect(canvas.queryAllByRole('button')).toHaveLength(0);
  },
};
