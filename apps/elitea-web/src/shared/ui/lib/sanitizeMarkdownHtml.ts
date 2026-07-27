import DOMPurify from 'dompurify';

/**
 * Tags that can execute code, inject styles, or load external resources.
 * `svg`/`math` are included because both namespaces have their own XSS
 * vectors (e.g. `<svg onload=...>`, `<math>` namespace-confusion attacks).
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/lib/constants/markdown.constants.js`'s
 * `FORBIDDEN_HTML_TAGS`.
 */
export const FORBIDDEN_MARKDOWN_HTML_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'noscript',
  'svg',
  'math',
] as const;

/**
 * The ONE place `marked`-rendered HTML is sanitized before it reaches
 * `dangerouslySetInnerHTML` (`shared/ui/DefaultMarkdown/DefaultMarkdown.tsx`,
 * and — through `Token`/`Markdown` composing it —
 * `shared/ui/TooltipMarkdownContent/TooltipMarkdownContent.tsx`). This is a
 * real XSS surface: the markdown rendered here comes from user or
 * AI-generated chat content, not a trusted CMS, so both halves of the
 * defence matter:
 *
 *  - DOMPurify@3.4.12's OWN defaults already strip every `on*` event-handler
 *    attribute and reject `javascript:`/unknown-protocol URLs in `href`/
 *    `src` (verified empirically against the installed package — see this
 *    file's `.test.ts`; no extra `FORBID_ATTR`/`ALLOWED_URI_REGEXP` needed).
 *  - `FORBID_TAGS` closes the remaining hole DOMPurify leaves open BY
 *    DESIGN: `<script>`/`<style>`/`<iframe>`/... are "safe HTML" to a
 *    general-purpose sanitizer unless told otherwise — safe for a trusted
 *    CMS author, not safe for arbitrary chat/AI output.
 *  - `ADD_ATTR: ['target']` is the one attribute allow-listed on top of
 *    DOMPurify's own safe defaults. DOMPurify strips `target` by default
 *    (a bare `target="_blank"` is a reverse-tabnabbing vector via
 *    `window.opener`); `DefaultMarkdown.tsx`'s link renderer always pairs
 *    it with `rel="noopener noreferrer"` (which DOMPurify already allows),
 *    so allow-listing `target` here does not reopen that hole — this is
 *    DOMPurify's own documented recipe for "open links in a new tab".
 */
export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [...FORBIDDEN_MARKDOWN_HTML_TAGS],
    ADD_ATTR: ['target'],
  });
}
