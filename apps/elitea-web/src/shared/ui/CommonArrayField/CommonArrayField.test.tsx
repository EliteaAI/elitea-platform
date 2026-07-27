import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { CommonArrayField } from '.';

installCodeMirrorTestPolyfills();

describe('CommonArrayField', () => {
  describe('JSON editor branch (no items.enum)', () => {
    it('renders the pretty-printed JSON of the current value', () => {
      const { container } = renderWithTheme(
        <CommonArrayField
          fieldKey="tags"
          value={['a', 'b']}
          meta={{ label: 'Tags' }}
          onChange={vi.fn()}
        />,
      );
      expect(container.querySelector('.cm-content')).toHaveTextContent(/"a"/);
    });

    it('renders an empty array for an undefined value', () => {
      const { container } = renderWithTheme(
        <CommonArrayField
          fieldKey="tags"
          value={undefined}
          meta={{ label: 'Tags' }}
          onChange={vi.fn()}
        />,
      );
      expect(container.querySelector('.cm-content')).toHaveTextContent('[]');
    });

    it('parses a valid JSON array edited in the editor and reports it on blur', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { container } = renderWithTheme(
        <CommonArrayField
          fieldKey="tags"
          value={[]}
          meta={{ label: 'Tags' }}
          onChange={onChange}
        />,
      );
      const content = container.querySelector('.cm-content') as HTMLElement;
      await user.click(content);
      // `userEvent.keyboard` syntax: `{`/`[` open a key descriptor, so a
      // literal one is a doubled `{{`/`[[`; `}`/`]` need no escaping.
      await user.keyboard('{Control>}a{/Control}[["x"]');
      content.blur();
      expect(onChange).toHaveBeenCalledWith('tags', ['x']);
    });

    it('reports an empty array for valid JSON that is not itself an array', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { container } = renderWithTheme(
        <CommonArrayField
          fieldKey="tags"
          value={[]}
          meta={{ label: 'Tags' }}
          onChange={onChange}
        />,
      );
      const content = container.querySelector('.cm-content') as HTMLElement;
      await user.click(content);
      await user.keyboard('{Control>}a{/Control}{{"a":1}');
      content.blur();
      expect(onChange).toHaveBeenCalledWith('tags', []);
    });

    it('reports an empty array for invalid JSON text', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { container } = renderWithTheme(
        <CommonArrayField
          fieldKey="tags"
          value={[]}
          meta={{ label: 'Tags' }}
          onChange={onChange}
        />,
      );
      const content = container.querySelector('.cm-content') as HTMLElement;
      await user.click(content);
      await user.keyboard('{Control>}a{/Control}not json');
      content.blur();
      expect(onChange).toHaveBeenCalledWith('tags', []);
    });
  });

  describe('enum multi-select branch (property.items.enum)', () => {
    it('renders the enum values as checkbox options', async () => {
      const user = userEvent.setup();
      const { getByRole } = renderWithTheme(
        <CommonArrayField
          fieldKey="colors"
          value={['red']}
          meta={{ label: 'Colors' }}
          property={{ items: { enum: ['red', 'green', 'blue'] } }}
          onChange={vi.fn()}
        />,
      );
      await user.click(getByRole('combobox'));
      const listbox = getByRole('listbox');
      expect(listbox).toBeInTheDocument();
      expect(getByRole('option', { name: /red/ })).toHaveAttribute('aria-selected', 'true');
      expect(getByRole('option', { name: /green/ })).toHaveAttribute('aria-selected', 'false');
    });

    it('treats an undefined value as no selection', () => {
      const { getByRole } = renderWithTheme(
        <CommonArrayField
          fieldKey="colors"
          value={undefined}
          meta={{ label: 'Colors' }}
          property={{ items: { enum: ['red', 'green'] } }}
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('combobox')).not.toHaveTextContent(/red|green/);
    });

    it('calls onChange with the full new selection when an option is toggled on', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { getByRole } = renderWithTheme(
        <CommonArrayField
          fieldKey="colors"
          value={['red']}
          meta={{ label: 'Colors' }}
          property={{ items: { enum: ['red', 'green'] } }}
          onChange={onChange}
        />,
      );
      await user.click(getByRole('combobox'));
      await user.click(getByRole('option', { name: /green/ }));
      expect(onChange).toHaveBeenCalledWith('colors', ['red', 'green']);
    });

    it('calls onChange with the option removed when toggled off', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { getByRole } = renderWithTheme(
        <CommonArrayField
          fieldKey="colors"
          value={['red', 'green']}
          meta={{ label: 'Colors' }}
          property={{ items: { enum: ['red', 'green'] } }}
          onChange={onChange}
        />,
      );
      await user.click(getByRole('combobox'));
      await user.click(getByRole('option', { name: /red/ }));
      expect(onChange).toHaveBeenCalledWith('colors', ['green']);
    });

    it('disables the select when meta.disabled is set', () => {
      const { getByRole } = renderWithTheme(
        <CommonArrayField
          fieldKey="colors"
          value={[]}
          meta={{ label: 'Colors', disabled: true }}
          property={{ items: { enum: ['red'] } }}
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
