import { describe, expect, it } from 'vitest';

import { FORBIDDEN_MARKDOWN_HTML_TAGS, sanitizeMarkdownHtml } from './sanitizeMarkdownHtml';

describe('sanitizeMarkdownHtml', () => {
  // The mutation-proof target (see this unit's final report): mutating the
  // `FORBID_TAGS` call in sanitizeMarkdownHtml.ts to bypass sanitization
  // (e.g. `return html;`) turns this specific test RED.
  it('strips a <script> tag and its content entirely', () => {
    const dirty = '<p>before</p><script>alert(document.cookie)</script><p>after</p>';
    const clean = sanitizeMarkdownHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(document.cookie)');
    expect(clean).toBe('<p>before</p><p>after</p>');
  });

  it('strips every tag in FORBIDDEN_MARKDOWN_HTML_TAGS', () => {
    // Iterates the real exported list rather than a second hardcoded copy,
    // so this test can never silently drift from what the function forbids.
    for (const tag of FORBIDDEN_MARKDOWN_HTML_TAGS) {
      const clean = sanitizeMarkdownHtml(`<${tag}>payload</${tag}>`);
      expect(clean.toLowerCase()).not.toContain(`<${tag}`);
    }
  });

  it('strips on* event-handler attributes (DOMPurify default)', () => {
    const clean = sanitizeMarkdownHtml('<img src="x" onerror="alert(1)">');
    expect(clean).not.toContain('onerror');
    expect(clean).toBe('<img src="x">');
  });

  it('strips a javascript: href (DOMPurify default URI protocol check)', () => {
    const clean = sanitizeMarkdownHtml('<a href="javascript:alert(1)">link</a>');
    expect(clean).not.toContain('javascript:');
  });

  it('preserves ordinary safe formatting untouched', () => {
    const safe = '<p>Some <strong>bold</strong> and <em>em</em> and <code>code</code>.</p>';
    expect(sanitizeMarkdownHtml(safe)).toBe(safe);
  });

  it('preserves a safe external link with its attributes', () => {
    const safe = '<a href="https://example.com" title="Example">link</a>';
    expect(sanitizeMarkdownHtml(safe)).toBe(safe);
  });

  it('preserves target="_blank" when paired with rel="noopener noreferrer" (DOMPurify strips a bare target by default)', () => {
    const safe = '<a target="_blank" rel="noopener noreferrer" href="https://example.com">link</a>';
    expect(sanitizeMarkdownHtml(safe)).toContain('target="_blank"');
  });
});
