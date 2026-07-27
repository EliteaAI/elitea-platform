import type { ReactNode } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';

import { combineSx } from '../lib/combineSx';
import { TypographyWithConditionalTooltip } from '../TypographyWithConditionalTooltip';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface EllipsisTypographyProps {
  children: ReactNode;
  sx?: SxProps<Theme>;
  'data-testid'?: string;
}

/**
 * Single-line, ellipsis-truncated text that shows its own full content in a
 * tooltip once truncated — the app's default "long label in a tight
 * column" treatment (`bodySmall`/`text.secondary`, top-placed tooltip).
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/text/EllipsisTypography.jsx`.
 *
 * Deviation from the baseline: the baseline hand-rolled its own
 * `useCheckViewScrollHorizontally` hook (a second, near-identical
 * `scrollWidth > clientWidth` overflow check) wired to its own generic
 * `@/ComponentsLib/Tooltip`. This port composes `shared/ui`'s own
 * `TypographyWithConditionalTooltip` instead — same behaviour
 * (`useTextOverflow` under both), one implementation instead of two.
 */
export function EllipsisTypography({
  children,
  sx,
  'data-testid': dataTestId,
}: EllipsisTypographyProps): ReactNode {
  return (
    <TypographyWithConditionalTooltip
      title={children}
      placement="top"
      variant="bodySmall"
      color="text.secondary"
      {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
      sx={combineSx({ marginRight: '0.5rem', width: '100%' }, sx)}
    >
      {children}
    </TypographyWithConditionalTooltip>
  );
}
