import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { CodeMirrorEditor } from '.';

// The storybook project runs in a real Playwright browser (not jsdom), so
// this is not strictly required there — kept anyway so this story file
// stays runnable standalone under either project without surprises.
installCodeMirrorTestPolyfills();

const meta = {
  title: 'shared/ui/CodeMirrorEditor',
  component: CodeMirrorEditor,
  parameters: { a11y: { test: 'error' } },
  args: { value: '{\n  "hello": "world"\n}', 'aria-label': 'Tool config JSON', onChange: fn() },
} satisfies Meta<typeof CodeMirrorEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole('textbox');
    await expect(textbox).toHaveAttribute('aria-readonly', 'true');
  },
};

export const WithJsonLinter: Story = {
  // `extensions` (a `render` arg, not a story `args` entry): CM6 `Extension`
  // values are internal graphs with circular references — passed through
  // `args`, Storybook's own arg-diffing tries to JSON-serialize them for its
  // controls panel and logs a "detected a cycle" warning every run. `render`
  // builds the element directly, bypassing that serialization entirely.
  render: (args) => (
    <CodeMirrorEditor
      {...args}
      extensions={[json(), linter(jsonParseLinter())]}
    />
  ),
};

/** Types past the four-character cap and asserts the extra text was rejected. */
export const MaxLengthTruncates: Story = {
  args: { value: '', maxLength: 4, 'aria-label': 'Short code' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.keyboard('abcdefgh');
    await expect(textbox).toHaveTextContent('abcd');
  },
};

/** Typing fires the debounced `onChange` with the full edited value. */
export const ReportsEditsOnChange: Story = {
  args: { value: '' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const textbox = canvas.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.keyboard('hi');
    // `onChange` is debounced ~30ms (matching baseline's `notifyChange`
    // debounce, so a bulk-editing consumer isn't re-rendered per keystroke)
    // — `waitFor` retries the assertion instead of asserting immediately.
    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith('hi'));
  },
};
