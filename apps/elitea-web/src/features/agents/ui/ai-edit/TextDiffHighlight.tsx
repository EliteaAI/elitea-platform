import type { ReactNode } from 'react';
import { useMemo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { computeWordDiff } from '../../lib/textDiff';

/**
 * Port of `apps/elitea-ui/src/[fsd]/entities/edit-entity-with-ai/ui/
 * TextDiffHighlight.jsx` — one side of a word-level diff, tinted.
 *
 * **DISCLOSED DEVIATION — read-only, no `contentEditable` mode.** The
 * baseline's component doubles as an editor: `editable` swaps the rendered
 * spans for a `contentEditable` div whose `innerHTML` it writes by hand and
 * whose paste/drop handlers strip rich content. That is a second, much
 * riskier component (hand-built HTML injection, `document.execCommand`,
 * manual selection ranges) and this app has no other `contentEditable`
 * surface built that way. The review step here therefore SHOWS the diff and
 * edits the proposed text in a plain `TextField` beside it — the same two
 * capabilities, without an innerHTML writer.
 *
 * **Colour** comes from `success`/`error` palette tokens, not the baseline's
 * `palette.diff.added`/`.removed`: this app's theme declares no `diff`
 * palette group (`shared/brand/toMuiPalette.ts`), and `npm run theme-gate`
 * rejects a raw hex here.
 */
export interface TextDiffHighlightProps {
  readonly original: string;
  readonly modified: string;
  /** `'original'` hides additions; `'modified'` hides removals. */
  readonly mode: 'original' | 'modified';
}

export function TextDiffHighlight({ original, modified, mode }: TextDiffHighlightProps): ReactNode {
  const segments = useMemo(() => computeWordDiff(original, modified), [original, modified]);
  const visible = useMemo(
    () => segments.filter((segment) => (mode === 'original' ? segment.type !== 'added' : segment.type !== 'removed')),
    [segments, mode],
  );

  return (
    <Typography
      component="div"
      variant="bodySmall"
      color="text.secondary"
      sx={containerSx}
      data-testid={`text-diff-${mode}`}
    >
      {visible.map((segment, index) => (
        <Box
          key={`${segment.type}-${String(index)}`}
          component="span"
          sx={segment.type === 'added' ? addedSx : segment.type === 'removed' ? removedSx : undefined}
        >
          {segment.text}
        </Box>
      ))}
    </Typography>
  );
}

const containerSx: SxProps<Theme> = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.5rem' };
const addedSx: SxProps<Theme> = (theme) => ({
  backgroundColor: theme.vars.palette.success.light,
  borderRadius: theme.vars.shape.radiusSm,
});
const removedSx: SxProps<Theme> = (theme) => ({
  backgroundColor: theme.vars.palette.error.light,
  borderRadius: theme.vars.shape.radiusSm,
});
