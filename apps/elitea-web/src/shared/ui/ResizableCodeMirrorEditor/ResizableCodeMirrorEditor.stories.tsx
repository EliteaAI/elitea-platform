import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { ResizableCodeMirrorEditor } from '.';

// The storybook project runs in a real Playwright browser (not jsdom), so
// this is not strictly required there — kept anyway so this story file
// stays runnable standalone under either project without surprises.
installCodeMirrorTestPolyfills();

const meta = {
  title: 'shared/ui/ResizableCodeMirrorEditor',
  component: ResizableCodeMirrorEditor,
  parameters: { a11y: { test: 'error' } },
  args: { value: '{\n  "hello": "world"\n}', fieldName: 'Tool config' },
} satisfies Meta<typeof ResizableCodeMirrorEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReadOnly: Story = {
  args: { readOnly: true },
};

export const WithExpandButton: Story = {
  args: { expandAction: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Full screen view' })).toBeInTheDocument();
  },
};

/** Clicking the expand button opens a fullscreen `BaseModal` editing the same value. */
export const OpensFullscreen: Story = {
  args: { expandAction: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Full screen view' }));
    // `Dialog` portals outside `canvasElement`, so the assertion below reads
    // from `document.body` via storybook/test's own `within(document.body)`.
    await waitFor(() => expect(within(document.body).getByRole('dialog')).toBeInTheDocument());
  },
};

/** Edits in the box commit on blur, not per keystroke. */
export const CommitsOnBlur: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.keyboard('X');
    await expect(textbox).toHaveTextContent(/^X/);
    textbox.blur();
  },
};
