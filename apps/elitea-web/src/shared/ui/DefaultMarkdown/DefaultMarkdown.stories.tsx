import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { DefaultMarkdown } from '.';

const meta = {
  title: 'shared/ui/DefaultMarkdown',
  component: DefaultMarkdown,
  parameters: { a11y: { test: 'error' } },
  args: { markdown: 'Some **bold** and *em* text with a [link](https://example.com).' },
} satisfies Meta<typeof DefaultMarkdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('bold')).toBeInTheDocument();
    await expect(canvas.getByText('link')).toBeInTheDocument();
  },
};

export const Inline: Story = {
  args: { markdown: 'inline **bold**', inline: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('bold')).toBeInTheDocument();
  },
};

export const RawHtmlDropped: Story = {
  name: 'renderHtml=false drops literal HTML',
  args: { markdown: 'A <b>bold html</b> B', inline: true, renderHtml: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector('b')).toBeNull();
    await expect(canvas.getByText(/bold html/)).toBeInTheDocument();
  },
};

export const MaliciousInputSanitized: Story = {
  name: 'a <script> in the source is stripped, not executed',
  args: { markdown: 'before\n\n<script>window.__pwned = true</script>\n\nafter' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.innerHTML).not.toContain('<script');
    await expect(canvasElement.innerHTML).not.toContain('__pwned');
  },
};
