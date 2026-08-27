/**
 * MarkdownContent — the assistant's answer, rendered.
 *
 * The published widget renders with `react-markdown` + `remark-gfm` +
 * `rehype-raw`, and special-cases ```mermaid fences into a `mermaid`-rendered
 * diagram and images into a lightbox portal. All four of those are dependencies
 * this app does not have.
 *
 * IT DELEGATES TO THE APP'S OWN RENDERER INSTEAD, and that is a correctness
 * decision before it is a dependency one. `shared/ui/Markdown` is a `marked`
 * lexer feeding `Token`, which owns this app's SANITIZE-BEFORE-RENDER boundary
 * — the single policy that decides what HTML an AI-authored string is allowed to
 * put on the page. Adding `rehype-raw` here would give one widget a second,
 * looser answer to that question than every other surface that renders model
 * output, which is precisely the kind of divergence a support widget — a surface
 * that renders text an attacker may have influenced through a support question —
 * must not have.
 *
 * WHAT IS LOST, rather than quietly dropped:
 *
 *   - MERMAID DIAGRAMS render as a fenced code block. Nothing in this app
 *     renders mermaid, so the alternative was a new runtime dependency for one
 *     widget's code fences.
 *   - THE IMAGE LIGHTBOX is gone; images render inline at their natural size,
 *     bounded by the message bubble's CSS.
 *
 * `isAnimating` is still accepted and still meaningful: the typewriter feeds
 * PARTIAL markdown, and `renderHtml={false}` keeps a half-written tag from being
 * interpreted mid-stream.
 */
import type { ReactNode } from 'react';
import { memo } from 'react';

import { Markdown } from '@/shared/ui/Markdown';

interface MarkdownContentProps {
  readonly content: string;
  readonly isAnimating?: boolean;
}

const MarkdownContent = memo(({ content, isAnimating = false }: MarkdownContentProps): ReactNode => (
  <div className="elitea-assistant-markdown">
    <Markdown renderHtml={!isAnimating}>{content}</Markdown>
  </div>
));

MarkdownContent.displayName = 'MarkdownContent';

export default MarkdownContent;
