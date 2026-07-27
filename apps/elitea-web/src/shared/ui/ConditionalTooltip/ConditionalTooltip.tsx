import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { TooltipProps } from '@mui/material/Tooltip';
import Tooltip from '@mui/material/Tooltip';
import type { Theme } from '@mui/material/styles';

import { useTextOverflow } from '../lib/useTextOverflow';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface ConditionalTooltipProps {
  children: ReactNode;
  /** Tooltip content, shown ONLY when `children` is actually truncated. */
  title: ReactNode;
  placement?: TooltipProps['placement'];
  arrow?: boolean;
  'data-testid'?: string;
}

/**
 * Wraps `children` in `Tooltip`, but only arms it when the wrapped span is
 * actually overflowing (truncated) — untruncated content never shows a
 * tooltip. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/tooltip/ConditionalTooltip.jsx`.
 *
 * Deviation from the baseline: colour/typography (`backgroundColor`,
 * `color`, `typography.labelSmall`, the arrow's colour) are dropped from
 * the local `sx` — `shared/brand/mui-overrides/MuiTooltip.ts` (unit S1)
 * already wires that globally (ported verbatim from the same
 * `MainTheme.js:342-353` this component's own baseline duplicated
 * locally), so restating it here would be two sources of truth for one
 * style. Only the per-usage layout extras it does NOT cover (padding,
 * `maxWidth`, `margin`, `wordWrap`, the popper's z-index/offset) stay
 * local.
 */
export function ConditionalTooltip({
  children,
  title,
  placement = 'right',
  arrow = true,
  'data-testid': dataTestId,
}: ConditionalTooltipProps): ReactNode {
  const { textRef, isOverflowing } = useTextOverflow(title);

  return (
    <Tooltip
      arrow={arrow}
      title={isOverflowing ? title : ''}
      placement={placement}
      disableHoverListener={!isOverflowing}
      slotProps={{
        tooltip: {
          sx: {
            padding: '0.25rem 0.5rem',
            maxWidth: '18.75rem',
            margin: '0.125rem',
            wordWrap: 'break-word',
          },
        },
        popper: {
          sx: (theme: Theme) => ({ zIndex: theme.vars.zIndex.tooltip }),
          modifiers: [{ name: 'offset', options: { offset: [0, 8] } }],
        },
      }}
    >
      <Box
        component="span"
        ref={textRef}
        data-testid={dataTestId}
        sx={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden' }}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
