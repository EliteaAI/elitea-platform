import type { Meta, StoryObj } from '@storybook/react-vite';
import { marked, type MarkedToken } from 'marked';
import { expect, within } from 'storybook/test';

import { Token } from '.';

function lexOne(markdown: string): MarkedToken {
  return marked.lexer(markdown)[0] as MarkedToken;
}

const meta = {
  title: 'shared/ui/Token',
  component: Token,
  parameters: { a11y: { test: 'error' } },
  args: { token: lexOne('# Heading') },
} satisfies Meta<typeof Token>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Heading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Heading')).toBeInTheDocument();
    await expect(canvasElement.querySelector('h1')).not.toBeNull();
  },
};

export const CodeBlock: Story = {
  args: { token: lexOne('```js\nconst x = 1;\n```') },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('pre > code')?.textContent).toBe('const x = 1;');
  },
};

export const List: Story = {
  args: { token: lexOne('- one\n- two\n- three') },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('li')).toHaveLength(3);
  },
};

export const TaskList: Story = {
  args: { token: lexOne('- [x] done\n- [ ] not done') },
  play: async ({ canvasElement }) => {
    const boxes = canvasElement.querySelectorAll('input[type="checkbox"]');
    await expect(boxes).toHaveLength(2);
    await expect((boxes[0] as HTMLInputElement).checked).toBe(true);
  },
};

export const Table: Story = {
  args: { token: lexOne('| Name | Age |\n|---|---|\n| Ada | 36 |') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Name')).toBeInTheDocument();
    await expect(canvas.getByText('Ada')).toBeInTheDocument();
  },
};

export const Blockquote: Story = {
  args: { token: lexOne('> quoted **bold** text') },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('blockquote strong')?.textContent).toBe('bold');
  },
};
