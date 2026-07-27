import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ExpandedViewerModal } from '.';

const meta = {
  title: 'shared/ui/modal/ExpandedViewerModal',
  component: ExpandedViewerModal,
  parameters: { a11y: { test: 'error' } },
  args: {
    open: true,
    title: 'pipeline-output.json',
    content: '{"status": "ok"}',
    onClose: fn(),
  },
} satisfies Meta<typeof ExpandedViewerModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByText('pipeline-output.json')).toBeInTheDocument();
    await expect(canvas.getByText('{"status": "ok"}')).toBeInTheDocument();
  },
};

export const WithLanguageSelector: Story = {
  args: {
    language: {
      value: 'json',
      options: [
        { label: 'JSON', value: 'json' },
        { label: 'YAML', value: 'yaml' },
        { label: 'Plain text', value: 'text' },
      ],
      onChange: fn(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByRole('combobox')).toBeInTheDocument();
  },
};

export const WithCopyButton: Story = {
  args: { header: { onCopy: fn() } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const copyButton = canvas.getByRole('button', { name: 'Copy to clipboard' });
    await userEvent.click(copyButton);
    await expect(args.header?.onCopy).toHaveBeenCalled();
  },
};

export const WithCustomButtonsAndFooter: Story = {
  args: {
    header: { customButtons: <button type="button">Export</button> },
    footer: <div style={{ padding: '0.5rem' }}>Read-only preview</div>,
  },
};

/** Keyboard path: Escape closes (inherited from `BaseModal`). */
export const ClosesOnEscape: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const dialog = canvas.getByRole('dialog');
    dialog.focus();
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};
