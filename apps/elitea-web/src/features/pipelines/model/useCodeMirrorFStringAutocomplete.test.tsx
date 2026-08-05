import { useState } from 'react';

import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';

import { useCodeMirrorFStringAutocomplete } from './useCodeMirrorFStringAutocomplete';
import { FStringAutocompletePopper } from '../ui/FStringAutocompletePopper';

installCodeMirrorTestPolyfills();

/**
 * `installCodeMirrorTestPolyfills()` stubs `Range.getClientRects()` to an
 * EMPTY list (jsdom has no real text-layout engine to compute real ones —
 * that file's own doc comment records this) so CM6 can mount at all. A real
 * empty rect list means `EditorView.coordsAtPos` — which this hook's
 * `updateAutocompleteFromView` uses to anchor the autocomplete popper at
 * the text caret — always resolves to `null` under jsdom, which would make
 * `popperProps.open` false regardless of the underlying autocomplete state
 * actually being open. This is a further, test-local, R-M1-sanctioned
 * ("browser APIs jsdom lacks") patch scoped to just this file: a fixed
 * synthetic caret rect, so this file can assert on the real anchor-gated
 * `open`/rendered-popper behaviour instead of only the position-independent
 * state.
 */
EditorView.prototype.coordsAtPos = function coordsAtPosStub() {
  return { left: 0, right: 0, top: 0, bottom: 14 };
};

function getContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new Error('CodeMirror content element not found');
  return content;
}

interface HarnessProps {
  readonly enableFStringAutocomplete?: boolean;
  readonly onChange?: (value: string) => void;
}

/** Minimal host wiring the hook's `mergedExtensions`/`popperProps` onto a real `CodeMirrorEditor`, mirroring `AIAssistantCodeMirrorInput`'s own composition. */
function Harness({ enableFStringAutocomplete = true, onChange }: HarnessProps) {
  const [value, setValue] = useState('');
  const { mergedExtensions, popperProps } = useCodeMirrorFStringAutocomplete({
    notifyChange: (next) => {
      setValue(next);
      onChange?.(next);
    },
    enableFStringAutocomplete,
    stateVariableOptions: [
      { value: 'foo', label: 'foo' },
      { value: 'foobar', label: 'foobar' },
      { value: 'bar', label: 'bar' },
    ],
  });

  return (
    <div>
      <CodeMirrorEditor
        value={value}
        extensions={mergedExtensions}
        onChange={setValue}
      />
      {enableFStringAutocomplete && <FStringAutocompletePopper {...popperProps} />}
    </div>
  );
}

describe('useCodeMirrorFStringAutocomplete', () => {
  // `FStringAutocompletePopper` renders via MUI's `Popper`, which portals
  // its content onto `document.body` (not inside RTL's `container`) unless
  // `disablePortal` is set — it isn't — so every popper-content assertion
  // below reads `document.body`, not `container`.

  it('opens the popper with filtered options after typing "{fo"', async () => {
    const user = userEvent.setup({ delay: 40 });
    const { container } = renderWithTheme(<Harness />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('{{fo');

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="menuitem"]')).not.toBeNull();
    });
    const menuItemTexts = [...document.body.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
    expect(menuItemTexts).toEqual(['foo', 'foobar']);
  });

  it('does not open the popper when enableFStringAutocomplete is false', async () => {
    const user = userEvent.setup({ delay: 40 });
    const { container } = renderWithTheme(<Harness enableFStringAutocomplete={false} />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('{{fo');

    expect(document.body.querySelector('[role="menuitem"]')).toBeNull();
  });

  it('closes the popper on Escape', async () => {
    const user = userEvent.setup({ delay: 40 });
    const { container } = renderWithTheme(<Harness />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('{{fo');
    await vi.waitFor(() => expect(document.body.textContent).toContain('foobar'));

    await user.keyboard('{Escape}');

    await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')).toBeNull());
  });

  it('ArrowDown cycles highlighted option forward, wrapping from the last back to the first', async () => {
    const user = userEvent.setup({ delay: 40 });
    renderWithTheme(<Harness />);
    const content = document.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('{{fo');
    await vi.waitFor(() => expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(2));

    const getHighlighted = () => document.body.querySelector('[role="menuitem"].Mui-selected')?.textContent;
    // Initial highlighted option is the first ("foo").
    expect(getHighlighted()).toBe('foo');

    await user.keyboard('{ArrowDown}');
    await vi.waitFor(() => expect(getHighlighted()).toBe('foobar'));

    // Wraps back to the first after the last.
    await user.keyboard('{ArrowDown}');
    await vi.waitFor(() => expect(getHighlighted()).toBe('foo'));
  });

  it('ArrowUp cycles highlighted option backward, wrapping from the first to the last', async () => {
    const user = userEvent.setup({ delay: 40 });
    renderWithTheme(<Harness />);
    const content = document.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('{{fo');
    await vi.waitFor(() => expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(2));

    const getHighlighted = () => document.body.querySelector('[role="menuitem"].Mui-selected')?.textContent;
    expect(getHighlighted()).toBe('foo');

    await user.keyboard('{ArrowUp}');
    await vi.waitFor(() => expect(getHighlighted()).toBe('foobar'));
  });

  it('selecting a suggestion by clicking it replaces the in-progress {query the same way Enter does', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ delay: 40 });
    renderWithTheme(<Harness onChange={onChange} />);
    const content = document.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('{{bar');
    await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')).not.toBeNull());

    const barItem = [...document.body.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent === 'bar');
    expect(barItem).toBeDefined();
    await user.click(barItem as Element);

    await vi.waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('{bar}');
    });
    await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')).toBeNull());
  });

  it('ArrowDown/ArrowUp are no-ops (do not throw or move focus oddly) when there are zero filtered options', async () => {
    const user = userEvent.setup({ delay: 40 });
    renderWithTheme(<Harness />);
    const content = document.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    // "{zzz" matches none of foo/foobar/bar -- the popper's autocomplete state opens with
    // zero filtered options, taking the `filteredStateVariableOptions.length === 0` branch.
    await user.keyboard('{{zzz');

    expect(document.body.querySelector('[role="menuitem"]')).toBeNull();
    await expect(user.keyboard('{ArrowDown}{ArrowUp}')).resolves.toBeUndefined();
  });

  it('does not open the popper (and closes any existing one) once the editor loses focus', async () => {
    const user = userEvent.setup({ delay: 40 });
    renderWithTheme(
      <div>
        <Harness />
        <button type="button">elsewhere</button>
      </div>,
    );
    const content = document.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('{{fo');
    await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')).not.toBeNull());

    await user.click(document.querySelector('button') as HTMLElement);

    await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')).toBeNull());
  });

  it('never opens the popper when stateVariableOptions is empty (isAutocompleteActive false — no tracking/keymap extensions wired at all)', async () => {
    function EmptyOptionsHarness() {
      const [value, setValue] = useState('');
      const { mergedExtensions, popperProps } = useCodeMirrorFStringAutocomplete({
        notifyChange: setValue,
        enableFStringAutocomplete: true,
        stateVariableOptions: [],
      });
      return (
        <div>
          <CodeMirrorEditor
            value={value}
            extensions={mergedExtensions}
            onChange={setValue}
          />
          <FStringAutocompletePopper {...popperProps} />
        </div>
      );
    }

    const user = userEvent.setup({ delay: 40 });
    const { container } = renderWithTheme(<EmptyOptionsHarness />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('{{fo');

    expect(document.body.querySelector('[role="menuitem"]')).toBeNull();
  });

  it('inserting a suggestion via Enter replaces the in-progress {query with the full variable and closes the brace', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ delay: 40 });
    renderWithTheme(<Harness onChange={onChange} />);
    const content = document.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('{{foo');
    await vi.waitFor(() => expect(content.textContent).toContain('{foo'));

    await user.keyboard('{Enter}');

    await vi.waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('{foo}');
    });
  });
});
