import type { ReactNode } from 'react';

import ArrowForwardIosSharpIcon from '@mui/icons-material/ArrowForwardIosSharp';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { Theme } from '@mui/material/styles';

import { combineSx } from '../lib/combineSx';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export type StyledExpandMoreIconProps = SvgIconProps;

/**
 * The accordion expand/collapse chevron, coloured from the icon-fill token
 * and rotated by `StyledAccordionSummary` when the panel is expanded.
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/accordion/StyledExpandMoreIcon.jsx`.
 */
export function StyledExpandMoreIcon({ sx, ...rest }: StyledExpandMoreIconProps): ReactNode {
  return (
    <ArrowForwardIosSharpIcon
      sx={combineSx((theme: Theme) => ({ color: theme.vars.palette.icon.fill.default }), sx)}
      {...rest}
    />
  );
}
