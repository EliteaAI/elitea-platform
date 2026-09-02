/**
 * A line diff, rendered.
 *
 * The arithmetic is `shared/lib/lineDiff` and is not repeated here: this
 * component only paints the parts it is handed. Added lines carry a `+` and a
 * green ground, removed lines a `-` and a red one, and the markers are TEXT
 * rather than colour alone, so the diff still reads without colour vision and
 * in a screenshot's greyscale.
 *
 * First consumer: the DeepWiki mermaid quick fix (DWIKI-007), which shows the
 * proposed block against the current one before anything is saved.
 */
import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';

import type { DiffPart } from '@/shared/lib/lineDiff';

export interface DiffViewProps {
  readonly parts: readonly DiffPart[];
  readonly 'data-testid'?: string;
}

const MARKER: Record<DiffPart['kind'], string> = {
  unchanged: ' ',
  added: '+',
  removed: '-',
};

/**
 * The ground behind a line: the brand's own success/error token with a hex
 * alpha suffix. The palette is CSS-variable-backed so a white-label brand can
 * retint it, and the suffix form is the one this codebase already uses for a
 * translucent ground (`AddModelButton.tsx`); a literal `rgba(...)` would be a
 * raw colour the theme gate refuses (R-T1).
 */
function groundFor(kind: DiffPart['kind'], theme: Theme): string {
  if (kind === 'added') return theme.vars.palette.background.indexResult.success;
  if (kind === 'removed') return theme.vars.palette.background.indexResult.error;
  return 'transparent';
}

export function DiffView({ parts, 'data-testid': dataTestId }: DiffViewProps): React.JSX.Element {
  return (
    <Box
      component="pre"
      data-testid={dataTestId}
      sx={(theme: Theme) => ({
        margin: 0,
        padding: 1,
        overflowX: 'auto',
        ...theme.typography.bodySmall,
        fontFamily: theme.typography.fontFamilyMono,
        border: `1px solid ${theme.vars.palette.divider}`,
        borderRadius: theme.vars.shape.radiusMd,
      })}
    >
      {parts.map((part, partIndex) =>
        part.lines.map((line, lineIndex) => (
          <Box
            component="span"
            // A diff has no stable identity per line: the same text can appear
            // added and removed. Position within the rendered list is the key.
            // eslint-disable-next-line react/no-array-index-key -- see above
            key={`${String(partIndex)}-${String(lineIndex)}`}
            data-diff-kind={part.kind}
            sx={(theme: Theme) => ({
              display: 'block',
              whiteSpace: 'pre',
              backgroundColor: groundFor(part.kind, theme),
            })}
          >
            {MARKER[part.kind]} {line}
          </Box>
        )),
      )}
    </Box>
  );
}
