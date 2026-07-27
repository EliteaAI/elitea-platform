import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Markdown } from '.';

const meta = {
  title: 'shared/ui/Markdown',
  component: Markdown,
  parameters: { a11y: { test: 'error' } },
  args: {
    children: [
      '# Release notes',
      '',
      'This release adds **streaming** responses and fixes a few bugs.',
      '',
      '## Highlights',
      '',
      '- Faster first-token latency',
      '- Markdown tables now render correctly',
      '- [Full changelog](https://example.com/changelog)',
      '',
      '```ts',
      "const greeting = 'hello';",
      '```',
    ].join('\n'),
  },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Release notes')).toBeInTheDocument();
    await expect(canvas.getByText('streaming')).toBeInTheDocument();
    await expect(canvas.getByText('Full changelog')).toBeInTheDocument();
  },
};

export const MaliciousInputSanitized: Story = {
  name: 'a <script> anywhere in the document is stripped, not executed',
  args: {
    children: 'Ordinary text, then <script>window.__pwned = true</script> more text.',
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.innerHTML).not.toContain('<script');
    await expect(canvasElement.innerHTML).not.toContain('__pwned');
  },
};
