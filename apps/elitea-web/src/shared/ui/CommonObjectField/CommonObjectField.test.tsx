import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { installCodeMirrorTestPolyfills } from '../lib/field/codeMirrorTestPolyfills';
import { CommonObjectField } from '.';

installCodeMirrorTestPolyfills();

describe('CommonObjectField', () => {
  it('renders the pretty-printed JSON of the current value', () => {
    const { container } = renderWithTheme(
      <CommonObjectField
        fieldKey="config"
        value={{ a: 1 }}
        meta={{ label: 'Config' }}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.cm-content')).toHaveTextContent(/"a":\s*1/);
  });

  it('renders an empty object for an undefined value', () => {
    const { container } = renderWithTheme(
      <CommonObjectField
        fieldKey="config"
        value={undefined}
        meta={{ label: 'Config' }}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.cm-content')).toHaveTextContent('{}');
  });

  it('parses valid JSON edited in the editor and reports it on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <CommonObjectField
        fieldKey="config"
        value={{}}
        meta={{ label: 'Config' }}
        onChange={onChange}
      />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    // A bare click just places the cursor (typically at the start), so
    // typing straight away would insert before the existing "{}"
    // placeholder rather than replace it — `Ctrl+A` first (CM6's own
    // `selectAll` binding; the generic `{selectall}` pseudo-key has no
    // effect on a contenteditable-based editor like this one) selects the
    // whole document so the typed text replaces it.
    await user.keyboard('{Control>}a{/Control}{{"a":1}');
    content.blur();
    expect(onChange).toHaveBeenCalledWith('config', { a: 1 });
  });

  it('reports an empty object for invalid JSON, matching the baseline silent-fallback', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <CommonObjectField
        fieldKey="config"
        value={{}}
        meta={{ label: 'Config' }}
        onChange={onChange}
      />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('not json');
    content.blur();
    expect(onChange).toHaveBeenCalledWith('config', {});
  });

  it('renders the label and a fullscreen expand button', () => {
    const { getByText, getByRole } = renderWithTheme(
      <CommonObjectField
        fieldKey="config"
        value={{}}
        meta={{ label: 'Config' }}
        onChange={vi.fn()}
      />,
    );
    expect(getByText('Config')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Full screen view' })).toBeInTheDocument();
  });

  it('marks the editor read-only when meta.disabled is set', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <CommonObjectField
        fieldKey="config"
        value={{}}
        meta={{ label: 'Config', disabled: true }}
        onChange={onChange}
      />,
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    await user.click(content);
    await user.keyboard('x');
    expect(content).toHaveTextContent('{}');
  });
});
