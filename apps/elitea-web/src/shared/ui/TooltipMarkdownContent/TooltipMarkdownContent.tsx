import type { ReactNode } from 'react';

import type { Theme } from '@mui/material/styles';

import { Markdown } from '../Markdown';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface TooltipMarkdownContentProps {
  children: string;
}

/**
 * Markdown rendering tuned for a small tooltip bubble: zero-margin
 * paragraphs/lists so the content doesn't grow taller than a hovering
 * tooltip should. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/tooltip/TooltipMarkdownContent.jsx`.
 *
 * Deviation from the baseline: the baseline used `react-markdown` +
 * `remark-gfm`/`remark-breaks` with hand-written per-tag component
 * overrides (neither package is part of this app's dependency set — S1
 * installed `marked`/`dompurify` for this batch instead, per the unit
 * brief). Composing `shared/ui`'s own `Markdown` component here — rather
 * than a third from-scratch markdown pipeline — means the sanitize-
 * before-render boundary (`lib/sanitizeMarkdownHtml.ts`) covers tooltip
 * content too; a tooltip is exactly the kind of surface an AI/backend-
 * supplied hint string can reach.
 */
export function TooltipMarkdownContent({ children }: TooltipMarkdownContentProps): ReactNode {
  return (
    <Markdown
      sx={(theme: Theme) => ({
        '& p': { margin: 0 },
        '& p:not(:last-child)': { marginBottom: '0.25em' },
        '& ul, & ol': { margin: 0, paddingLeft: '1rem' },
        '& ul': { listStyleType: 'disc' },
        '& ol': { listStyleType: 'decimal' },
        '& li': { marginBottom: 0 },
        '& code': {
          background: theme.vars.palette.background.codeMirrorEditor,
          borderRadius: theme.vars.shape.radiusSm,
          padding: '0.0625rem 0.25rem',
        },
      })}
    >
      {children}
    </Markdown>
  );
}
