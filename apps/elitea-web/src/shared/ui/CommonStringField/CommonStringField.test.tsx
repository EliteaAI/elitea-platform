import { fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { CommonStringField } from '.';

installCodeMirrorTestPolyfills();

describe('CommonStringField', () => {
  describe('plain text branch', () => {
    it('renders the current value', () => {
      const { getByRole } = renderWithTheme(
        <CommonStringField
          fieldKey="name"
          value="hello"
          meta={{ label: 'Name' }}
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('textbox')).toHaveValue('hello');
    });

    it('calls onChange with the new value while typing', () => {
      const onChange = vi.fn();
      const { getByRole } = renderWithTheme(
        <CommonStringField
          fieldKey="name"
          value=""
          meta={{ label: 'Name' }}
          onChange={onChange}
        />,
      );
      fireEvent.change(getByRole('textbox'), { target: { value: 'world' } });
      expect(onChange).toHaveBeenCalledWith('name', 'world');
    });

    it('reports undefined (not an empty string) when cleared', () => {
      const onChange = vi.fn();
      const { getByRole } = renderWithTheme(
        <CommonStringField
          fieldKey="name"
          value="hi"
          meta={{ label: 'Name' }}
          onChange={onChange}
        />,
      );
      fireEvent.change(getByRole('textbox'), { target: { value: '' } });
      expect(onChange).toHaveBeenCalledWith('name', undefined);
    });

    it('shows the error message and marks the field invalid', () => {
      const { getByRole, getByText } = renderWithTheme(
        <CommonStringField
          fieldKey="name"
          value=""
          meta={{ label: 'Name', error: 'Name is required' }}
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
      expect(getByText('Name is required')).toBeInTheDocument();
    });

    it('renders a multiline input when property.multiline is set', () => {
      const { getByRole } = renderWithTheme(
        <CommonStringField
          fieldKey="name"
          value=""
          meta={{ label: 'Name' }}
          property={{ multiline: true }}
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('textbox').tagName).toBe('TEXTAREA');
    });

    it('renders a multiline input when the description mentions "description"', () => {
      const { getByRole } = renderWithTheme(
        <CommonStringField
          fieldKey="name"
          value=""
          meta={{ label: 'Name', description: 'A long description of the field' }}
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('textbox').tagName).toBe('TEXTAREA');
    });

    it('caps input length at property.maxLength', () => {
      const { getByRole } = renderWithTheme(
        <CommonStringField
          fieldKey="name"
          value=""
          meta={{ label: 'Name' }}
          property={{ maxLength: 5 }}
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('textbox')).toHaveAttribute('maxLength', '5');
    });

    it('does not render a copy button by default', () => {
      const { queryByRole } = renderWithTheme(
        <CommonStringField
          fieldKey="name"
          value="secret-ish"
          meta={{ label: 'Name' }}
          onChange={vi.fn()}
        />,
      );
      expect(queryByRole('button')).not.toBeInTheDocument();
    });

    describe('clipboard', () => {
      it('copies the current value when meta.clipboard is set', async () => {
        // No manual `navigator.clipboard` mock here: `@testing-library/
        // user-event` attaches its own clipboard stub to `window.navigator`
        // (a real, spy-free `Clipboard`-shaped object backing `readText`/
        // `writeText` with in-memory items) the first time an interaction
        // needs it, via a `configurable` property getter — a
        // `beforeEach`-installed `vi.fn()` mock gets silently overwritten by
        // that stub before this component's click handler ever runs (found
        // by instrumenting `shared/lib/clipboard.ts` directly: the function
        // actually invoked was user-event's own `async writeText(text)`, not
        // the mock). Reading the copied text back through that same stub is
        // the correct way to assert this, not fighting it with a second
        // mock.
        const user = userEvent.setup();
        const { getByRole } = renderWithTheme(
          <CommonStringField
            fieldKey="name"
            value="copy-me"
            meta={{ label: 'Name', clipboard: true }}
            onChange={vi.fn()}
          />,
        );
        await user.click(getByRole('button', { name: 'Copy to clipboard' }));
        await waitFor(async () => {
          expect(await navigator.clipboard.readText()).toBe('copy-me');
        });
      });
    });
  });

  describe('enum branch', () => {
    it('renders the enum values as options and excludes null-ish entries', async () => {
      const user = userEvent.setup();
      const { getByRole } = renderWithTheme(
        <CommonStringField
          fieldKey="mode"
          value="a"
          meta={{ label: 'Mode', enumValues: ['a', 'b', null as unknown as string, 'None'], isRequired: true }}
          onChange={vi.fn()}
        />,
      );
      await user.click(getByRole('combobox'));
      const listbox = getByRole('listbox');
      // `getByRole('combobox')`'s own closed-state display already renders
      // the selected option's text once ("a"), so scoping to the open
      // listbox (rather than the whole document) avoids a false
      // multiple-match failure against that duplicate.
      expect(within(listbox).getByText('a')).toBeInTheDocument();
      expect(within(listbox).getByText('b')).toBeInTheDocument();
      expect(within(listbox).queryByText('None')).not.toBeInTheDocument();
      expect(within(listbox).queryByText('null')).not.toBeInTheDocument();
    });

    it('adds a "None" option for an optional enum field with no schema default', async () => {
      const user = userEvent.setup();
      const { getByRole, getByText } = renderWithTheme(
        <CommonStringField
          fieldKey="mode"
          value="a"
          meta={{ label: 'Mode', enumValues: ['a', 'b'] }}
          onChange={vi.fn()}
        />,
      );
      await user.click(getByRole('combobox'));
      expect(getByText('None')).toBeInTheDocument();
    });

    it('does not add a "None" option when the field is required', async () => {
      const user = userEvent.setup();
      const { getByRole, queryByText } = renderWithTheme(
        <CommonStringField
          fieldKey="mode"
          value="a"
          meta={{ label: 'Mode', enumValues: ['a', 'b'], isRequired: true }}
          onChange={vi.fn()}
        />,
      );
      await user.click(getByRole('combobox'));
      expect(queryByText('None')).not.toBeInTheDocument();
    });

    it('calls onChange with the selected option', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { getByRole, getByText } = renderWithTheme(
        <CommonStringField
          fieldKey="mode"
          value="a"
          meta={{ label: 'Mode', enumValues: ['a', 'b'], isRequired: true }}
          onChange={onChange}
        />,
      );
      await user.click(getByRole('combobox'));
      await user.click(getByText('b'));
      expect(onChange).toHaveBeenCalledWith('mode', 'b');
    });
  });

  describe('code-language branch', () => {
    it('renders a CodeMirror editor instead of a plain text input', () => {
      const { container } = renderWithTheme(
        <CommonStringField
          fieldKey="script"
          value="print(1)"
          meta={{ label: 'Script', codeLanguage: 'python' }}
          onChange={vi.fn()}
        />,
      );
      expect(container.querySelector('.cm-content')).toHaveTextContent('print(1)');
    });

    it('commits the edited value on blur', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { container } = renderWithTheme(
        <CommonStringField
          fieldKey="script"
          value="abc"
          meta={{ label: 'Script', codeLanguage: 'python' }}
          onChange={onChange}
        />,
      );
      const content = container.querySelector('.cm-content') as HTMLElement;
      await user.click(content);
      await user.keyboard('X');
      content.blur();
      expect(onChange).toHaveBeenCalledWith('script', 'Xabc');
    });
  });
});
