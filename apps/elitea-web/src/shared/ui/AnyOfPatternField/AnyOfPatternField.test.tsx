import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { AnyOfPatternField } from '.';

installCodeMirrorTestPolyfills();

describe('AnyOfPatternField', () => {
  it('renders the pretty-printed JSON of the current value', () => {
    const { container } = renderWithTheme(
      <AnyOfPatternField
        fieldKey="values"
        value={['a', 'b']}
        meta={{ label: 'Values' }}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.cm-content')).toHaveTextContent(/"a"/);
  });

  it('renders an empty array for an undefined value', () => {
    const { container } = renderWithTheme(
      <AnyOfPatternField
        fieldKey="values"
        value={undefined}
        meta={{ label: 'Values' }}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.cm-content')).toHaveTextContent('[]');
  });

  it('parses a valid JSON array edited in the editor and reports it on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <AnyOfPatternField
        fieldKey="values"
        value={[]}
        meta={{ label: 'Values' }}
        onChange={onChange}
      />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    // `userEvent.keyboard` syntax: `[` opens a key descriptor, so a literal
    // one is a doubled `[[`; `]` needs no escaping (only `{`/`[` do).
    await user.keyboard('{Control>}a{/Control}[["x"]');
    content.blur();
    expect(onChange).toHaveBeenCalledWith('values', ['x']);
  });

  it('reports an empty array for valid JSON that is not itself an array (baseline quirk preserved)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <AnyOfPatternField
        fieldKey="values"
        value={[]}
        meta={{ label: 'Values' }}
        onChange={onChange}
      />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('{Control>}a{/Control}{{"a":1}');
    content.blur();
    expect(onChange).toHaveBeenCalledWith('values', []);
  });

  it('reports an empty array for invalid JSON text, matching the baseline silent-fallback', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <AnyOfPatternField
        fieldKey="values"
        value={[]}
        meta={{ label: 'Values' }}
        onChange={onChange}
      />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('{Control>}a{/Control}not json');
    content.blur();
    expect(onChange).toHaveBeenCalledWith('values', []);
  });

  it('reports an empty array when the field is cleared', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <AnyOfPatternField
        fieldKey="values"
        value={['x']}
        meta={{ label: 'Values' }}
        onChange={onChange}
      />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('{Control>}a{/Control}{Delete}');
    content.blur();
    expect(onChange).toHaveBeenCalledWith('values', []);
  });

  it('renders the label, required marker, and description tooltip', () => {
    const { getByText, getByRole } = renderWithTheme(
      <AnyOfPatternField
        fieldKey="values"
        value={[]}
        meta={{ label: 'Values', isRequired: true, description: 'A list of pattern values.' }}
        onChange={vi.fn()}
      />,
    );
    expect(getByText('Values *')).toBeInTheDocument();
    expect(getByRole('button', { name: 'More information' })).toBeInTheDocument();
  });

  it('marks the editor read-only when meta.disabled is set', () => {
    const { container } = renderWithTheme(
      <AnyOfPatternField
        fieldKey="values"
        value={[]}
        meta={{ label: 'Values', disabled: true }}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.cm-content')).toHaveAttribute('aria-readonly', 'true');
  });
});
