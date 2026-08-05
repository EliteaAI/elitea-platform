import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';

import { AIAssistantCodeMirrorInput } from './AIAssistantCodeMirrorInput';

installCodeMirrorTestPolyfills();

/**
 * `installCodeMirrorTestPolyfills()`'s `Range.getClientRects()` stub (an
 * empty list — jsdom has no real text-layout engine) makes
 * `EditorView.coordsAtPos` always resolve `null` under jsdom, which would
 * make the f-string popper's `open` (anchor-gated) always false regardless
 * of the underlying autocomplete state. Test-local, R-M1-sanctioned
 * ("browser APIs jsdom lacks") patch: a fixed synthetic caret rect, scoped
 * to this file — see `../model/useCodeMirrorFStringAutocomplete.test.tsx`'s
 * identical patch for the full rationale.
 */
EditorView.prototype.coordsAtPos = function coordsAtPosStub() {
  return { left: 0, right: 0, top: 0, bottom: 14 };
};

function getContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new Error('CodeMirror content element not found');
  return content;
}

describe('AIAssistantCodeMirrorInput', () => {
  it('renders the initial value', () => {
    const { container } = renderWithTheme(<AIAssistantCodeMirrorInput value="hello world" />);
    expect(getContent(container)).toHaveTextContent('hello world');
  });

  it('calls notifyChange with the edited text', async () => {
    const notifyChange = vi.fn();
    const user = userEvent.setup({ delay: 40 });
    const { container } = renderWithTheme(<AIAssistantCodeMirrorInput value="abc" notifyChange={notifyChange} />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('X');
    await vi.waitFor(() => expect(notifyChange).toHaveBeenCalledWith('Xabc'));
  });

  it('does not render the f-string popper when enableFStringAutocomplete is false', async () => {
    const user = userEvent.setup({ delay: 40 });
    const { container } = renderWithTheme(
      <AIAssistantCodeMirrorInput
        value=""
        enableFStringAutocomplete={false}
        stateVariableOptions={[{ value: 'foo', label: 'foo' }]}
      />,
    );
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('{{fo');
    expect(document.body.querySelector('[role="menuitem"]')).toBeNull();
  });

  it('shows filtered f-string suggestions when enableFStringAutocomplete is true', async () => {
    // `FStringAutocompletePopper` portals its content onto `document.body`
    // via MUI's `Popper` (`disablePortal` is not set), not inside `container`.
    const user = userEvent.setup({ delay: 40 });
    const { container } = renderWithTheme(
      <AIAssistantCodeMirrorInput
        value=""
        enableFStringAutocomplete
        stateVariableOptions={[
          { value: 'foo', label: 'foo' },
          { value: 'other', label: 'other' },
        ]}
      />,
    );
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('{{fo');

    await vi.waitFor(() => expect(document.body.textContent).toContain('foo'));
    expect(document.body.textContent).not.toContain('other');
  });

  it('respects readOnly (does not accept edits)', async () => {
    const notifyChange = vi.fn();
    const user = userEvent.setup({ delay: 40 });
    const { container } = renderWithTheme(
      <AIAssistantCodeMirrorInput
        value="locked"
        readOnly
        notifyChange={notifyChange}
      />,
    );
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('X');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(content).toHaveTextContent('locked');
    expect(notifyChange).not.toHaveBeenCalled();
  });

  it('calls onBlur with the current value', async () => {
    const onBlur = vi.fn();
    const user = userEvent.setup({ delay: 40 });
    const { container } = renderWithTheme(
      <div>
        <AIAssistantCodeMirrorInput value="abc" onBlur={onBlur} />
        <button type="button">elsewhere</button>
      </div>,
    );
    const content = getContent(container);
    await user.click(content);
    await user.click(container.querySelector('button') as HTMLElement);
    expect(onBlur).toHaveBeenCalledWith('abc');
  });
});
