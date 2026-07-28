import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { YamlCodeEditor } from './YamlCodeEditor';

installCodeMirrorTestPolyfills();

/** CM6's `.cm-content` is the real `role="textbox"` element every assertion below reads/types into. */
function getContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new Error('CodeMirror content element not found');
  return content;
}

describe('YamlCodeEditor', () => {
  it('renders the initial code', () => {
    const { container } = renderWithTheme(<YamlCodeEditor code="a: b" onChangeCode={vi.fn()} />);
    expect(getContent(container)).toHaveTextContent('a: b');
  });

  it('reports edits via onChangeCode, debounced', async () => {
    const user = userEvent.setup();
    const onChangeCode = vi.fn();
    const { container } = renderWithTheme(<YamlCodeEditor code="a: b" onChangeCode={onChangeCode} />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('X');
    await vi.waitFor(() => {
      expect(onChangeCode).toHaveBeenCalledWith('Xa: b');
    });
  });

  it('does not accept edits when disabled', async () => {
    const user = userEvent.setup();
    const onChangeCode = vi.fn();
    const { container } = renderWithTheme(<YamlCodeEditor code="a: b" onChangeCode={onChangeCode} disabled />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('X');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(content).toHaveTextContent('a: b');
    expect(onChangeCode).not.toHaveBeenCalled();
  });

  it('re-syncs its content when the `code` prop changes externally (e.g. a caller-driven reset)', () => {
    const { container, rerender } = renderWithTheme(<YamlCodeEditor code="first: 1" onChangeCode={vi.fn()} />);
    expect(getContent(container)).toHaveTextContent('first: 1');
    rerender(<YamlCodeEditor code="second: 2" onChangeCode={vi.fn()} />);
    expect(getContent(container)).toHaveTextContent('second: 2');
  });

  it('flags invalid YAML with the baseline error mark class once the linter runs', async () => {
    const user = userEvent.setup();
    const { container } = renderWithTheme(<YamlCodeEditor code="a: [" onChangeCode={vi.fn()} />);
    const content = getContent(container);
    await user.click(content);
    // Nudge the doc (a no-op keystroke would not trigger a new lint pass).
    await user.keyboard('{End} ');

    await vi.waitFor(
      () => {
        expect(container.querySelector('.error_yaml_code')).not.toBeNull();
      },
      { timeout: 2000 },
    );
  });

  it('clears the error mark once the document becomes valid YAML again', async () => {
    const user = userEvent.setup();
    const { container } = renderWithTheme(<YamlCodeEditor code="a: [" onChangeCode={vi.fn()} />);
    const content = getContent(container);
    await user.click(content);
    await user.keyboard('{End} ');
    await vi.waitFor(
      () => {
        expect(container.querySelector('.error_yaml_code')).not.toBeNull();
      },
      { timeout: 2000 },
    );

    await user.keyboard('{Backspace}{Backspace}');
    await vi.waitFor(
      () => {
        expect(container.querySelector('.error_yaml_code')).toBeNull();
      },
      { timeout: 2000 },
    );
  });

  it('carries the data-testid and pan/drag/wheel-exclusion class the pipeline flow canvas relies on', () => {
    const { getByTestId } = renderWithTheme(<YamlCodeEditor code="a: b" onChangeCode={vi.fn()} />);
    const wrapper = getByTestId('pipeline-yaml-editor');
    expect(wrapper).toHaveClass('nopan', 'nodrag', 'nowheel');
  });
});
