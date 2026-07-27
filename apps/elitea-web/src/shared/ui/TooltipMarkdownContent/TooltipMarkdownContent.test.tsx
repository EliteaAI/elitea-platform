import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { TooltipMarkdownContent } from '.';

describe('TooltipMarkdownContent', () => {
  it('renders markdown formatting', () => {
    const { container } = renderWithTheme(
      <TooltipMarkdownContent>{'Some **bold** and *em* text.'}</TooltipMarkdownContent>,
    );
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('em');
  });

  it('renders a tight list with no baseline paragraph/list margins', () => {
    const { container } = renderWithTheme(
      <TooltipMarkdownContent>{'- one\n- two'}</TooltipMarkdownContent>,
    );
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  // Security: tooltip content routinely comes from AI/backend-supplied hint
  // strings — the same sanitize-before-render boundary as the main
  // Markdown/DefaultMarkdown path must cover it.
  it('strips a <script> tag from tooltip content', () => {
    const { container } = renderWithTheme(
      <TooltipMarkdownContent>{'hint <script>window.__pwned = true</script> text'}</TooltipMarkdownContent>,
    );
    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).not.toContain('__pwned');
  });
});
