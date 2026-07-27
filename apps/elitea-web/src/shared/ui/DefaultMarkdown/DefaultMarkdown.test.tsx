import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { DefaultMarkdown } from '.';

describe('DefaultMarkdown', () => {
  it('renders block markdown wrapped in a <p>', () => {
    const { container } = renderWithTheme(<DefaultMarkdown markdown="Some **bold** text." />);
    const p = container.querySelector('p');
    expect(p).not.toBeNull();
    expect(p?.querySelector('strong')?.textContent).toBe('bold');
  });

  it('renders inline markdown with no wrapping <p>', () => {
    const { container } = renderWithTheme(
      <DefaultMarkdown
        markdown="Some **bold** text."
        inline
      />,
    );
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('renders as a span when inline', () => {
    const { getByTestId } = renderWithTheme(
      <DefaultMarkdown
        markdown="x"
        inline
        data-testid="md"
      />,
    );
    expect(getByTestId('md').tagName).toBe('SPAN');
  });

  it('renders as a div when block', () => {
    const { getByTestId } = renderWithTheme(
      <DefaultMarkdown
        markdown="x"
        data-testid="md"
      />,
    );
    expect(getByTestId('md').tagName).toBe('DIV');
  });

  it('preserves literal HTML from the source when renderHtml is true (the default)', () => {
    const { container } = renderWithTheme(
      <DefaultMarkdown
        markdown="A <b>bold html</b> B"
        inline
      />,
    );
    expect(container.querySelector('b')?.textContent).toBe('bold html');
  });

  it('drops literal HTML tags but keeps their text when renderHtml is false', () => {
    const { container, getByText } = renderWithTheme(
      <DefaultMarkdown
        markdown="A <b>bold html</b> B"
        inline
        renderHtml={false}
      />,
    );
    expect(container.querySelector('b')).toBeNull();
    expect(getByText(/bold html/)).toBeInTheDocument();
  });

  // Security: the DefaultMarkdown → marked → sanitizeMarkdownHtml →
  // dangerouslySetInnerHTML path is the real XSS surface this component
  // exists to close off. See lib/sanitizeMarkdownHtml.test.ts for the
  // unit-level proof and this unit's final report for the mutation-proof
  // that exercises this exact assertion end to end.
  it('strips a literal <script> tag from the source even when renderHtml is true', () => {
    const { container } = renderWithTheme(
      <DefaultMarkdown markdown={'before\n\n<script>window.__pwned = true</script>\n\nafter'} />,
    );
    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).not.toContain('__pwned');
  });

  it('opens markdown-sourced links in a new tab with rel=noopener noreferrer', () => {
    const { container } = renderWithTheme(
      <DefaultMarkdown
        markdown="[a link](https://example.com)"
        inline
      />,
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not inject target/rel for a link marked() itself refuses to wrap in <a> (a malformed URL its own cleanUrl rejects)', () => {
    // marked's own default `link` renderer returns the plain link TEXT with
    // no `<a>` wrapper at all when its internal `cleanUrl` throws (e.g. an
    // unpaired UTF-16 surrogate makes `encodeURI` throw a URIError) — the
    // target/rel post-processing (`linkHtml.startsWith('<a ')`) must handle
    // that "no tag to inject into" case without producing `<a target=...>`
    // on a stray, tag-less string.
    const { container } = renderWithTheme(
      <DefaultMarkdown
        // A plain JSX string attribute does not process `\u` escapes (unlike
        // a JS string literal) — an expression container is required so
        // this is the actual unpaired surrogate, not six literal characters.
        markdown={'[link](\uD800)'}
        inline
      />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('link');
  });

  it('forwards data-testid', () => {
    const { getByTestId } = renderWithTheme(
      <DefaultMarkdown
        markdown="x"
        data-testid="md-root"
      />,
    );
    expect(getByTestId('md-root')).toBeInTheDocument();
  });

  it('merges a caller sx with its own base styles', () => {
    const { getByTestId } = renderWithTheme(
      <DefaultMarkdown
        markdown="x"
        data-testid="md-root"
        sx={{ color: 'text.primary' }}
      />,
    );
    expect(getByTestId('md-root')).toBeInTheDocument();
  });
});
