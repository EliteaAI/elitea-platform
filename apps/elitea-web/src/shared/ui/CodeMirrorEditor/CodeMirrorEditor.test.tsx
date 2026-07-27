import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { CodeMirrorEditor } from '.';

installCodeMirrorTestPolyfills();

/** CM6's `.cm-content` is the actual `role="textbox"` element every assertion below reads/types into. */
function getContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new Error('CodeMirror content element not found');
  return content;
}

describe('CodeMirrorEditor', () => {
  it('renders the initial value', () => {
    const { container } = renderWithTheme(<CodeMirrorEditor value="hello" />);
    expect(getContent(container)).toHaveTextContent('hello');
  });

  it('exposes a real textbox role for the document content', () => {
    const { container } = renderWithTheme(<CodeMirrorEditor value="hello" />);
    expect(getContent(container)).toHaveAttribute('role', 'textbox');
  });

  it('calls onChange with the edited text, debounced', async () => {
    // Deliberately does NOT assert `not.toHaveBeenCalled()` immediately
    // after the keystroke: that raced the real 30ms debounce timer against
    // userEvent's own real (non-fake-timer) inter-action delays, and was
    // observed to fail intermittently on a slower CI runner where those
    // delays alone could exceed 30ms. Debouncing is proven instead by
    // typing several keystrokes in a row and confirming onChange coalesces
    // them into exactly one call with the final value -- a call-count
    // assertion that is deterministic regardless of how much real wall-clock
    // time each keystroke happens to take.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(<CodeMirrorEditor value="abc" onChange={onChange} />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('XYZ');
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('XYZabc');
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not accept edits when readOnly', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(<CodeMirrorEditor value="abc" onChange={onChange} readOnly />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('X');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(content).toHaveTextContent('abc');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports the current value on blur, fixing the baseline FocusEvent-vs-value mismatch', async () => {
    const user = userEvent.setup();
    const onBlur = vi.fn();
    const { container } = renderWithTheme(<CodeMirrorEditor value="abc" onBlur={onBlur} />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('X');
    content.blur();
    expect(onBlur).toHaveBeenCalledWith('Xabc');
    // The bug this guards: forwarding CodeMirror's native onBlur straight
    // through would hand the callback a `FocusEvent`, not a string.
    expect(typeof onBlur.mock.calls[0]?.[0]).toBe('string');
  });

  it('truncates input at maxLength', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(<CodeMirrorEditor value="" onChange={onChange} maxLength={3} />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('abcdef');
    expect(content).toHaveTextContent('abc');
    expect(content).not.toHaveTextContent('abcdef');
  });

  it('does not truncate when maxLength is left at its default (0 = unlimited)', async () => {
    const user = userEvent.setup();
    const { container } = renderWithTheme(<CodeMirrorEditor value="" />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('abcdef');
    expect(content).toHaveTextContent('abcdef');
  });

  it('reports linter diagnostics via onSyntaxError once the linter runs', async () => {
    const user = userEvent.setup();
    const onSyntaxError = vi.fn();
    const { container } = renderWithTheme(
      <CodeMirrorEditor
        value="{}"
        extensions={[json(), linter(jsonParseLinter())]}
        onSyntaxError={onSyntaxError}
      />,
    );
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('x');
    await vi.waitFor(
      () => {
        const lastCall = onSyntaxError.mock.calls.at(-1) as [unknown[]] | undefined;
        expect(lastCall?.[0]).toHaveLength(1);
      },
      { timeout: 2000 },
    );
    const errors = onSyntaxError.mock.calls.at(-1)?.[0] as { severity: string; message: string }[];
    expect(errors[0]?.severity).toBe('error');
    expect(errors[0]?.message).toMatch(/JSON/);
  });

  it('does not install a syntax-error listener when onSyntaxError is not passed', () => {
    // Regression guard for the `useMemo(() => onSyntaxError ? [...] : [], ...)`
    // branch — asserts the no-op path renders without throwing and without
    // needing a linter extension at all.
    const { container } = renderWithTheme(<CodeMirrorEditor value="{}" />);
    expect(getContent(container)).toHaveTextContent('{}');
  });

  it('sets aria-label on the textbox element, not an ancestor with no role', () => {
    const { container } = renderWithTheme(
      <CodeMirrorEditor
        value="abc"
        aria-label="Tool config JSON"
      />,
    );
    expect(getContent(container)).toHaveAttribute('aria-label', 'Tool config JSON');
  });

  it('has no aria-label when none is passed', () => {
    const { container } = renderWithTheme(<CodeMirrorEditor value="abc" />);
    expect(getContent(container)).not.toHaveAttribute('aria-label');
  });

  it('follows an external value change that was not just echoed back via onChange', () => {
    const { container, rerender } = renderWithTheme(<CodeMirrorEditor value="first" />);
    expect(getContent(container)).toHaveTextContent('first');
    rerender(<CodeMirrorEditor value="second" />);
    expect(getContent(container)).toHaveTextContent('second');
  });
});
