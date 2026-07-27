import type { ReactNode } from 'react';

import AccordionDetails from '@mui/material/AccordionDetails';
import type { AccordionDetailsProps } from '@mui/material/AccordionDetails';
import type { Theme } from '@mui/material/styles';

import { combineSx } from '../lib/combineSx';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export type StyledAccordionDetailsProps = AccordionDetailsProps;

/**
 * The accordion panel body: indented to align under the summary's title
 * text (past the chevron). Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/accordion/StyledAccordionDetails.jsx`.
 *
 * Deviation from the baseline: it also carried a nested
 * `'& .MuiAccordionDetails-root': { padding: 0 }` rule. `AccordionDetails`
 * renders a single root element with that exact class — there is no nested
 * `AccordionDetails` inside it for that selector to ever match, so the rule
 * was dead CSS in the baseline (and would additionally be banned by
 * `elitea/no-mui-internal-selector`, R-T6). Dropped.
 */
export function StyledAccordionDetails({ sx, ...rest }: StyledAccordionDetailsProps): ReactNode {
  return (
    <AccordionDetails
      sx={combineSx((theme: Theme) => ({ padding: `0 0 0 ${theme.spacing(4.5)}` }), sx)}
      {...rest}
    />
  );
}
