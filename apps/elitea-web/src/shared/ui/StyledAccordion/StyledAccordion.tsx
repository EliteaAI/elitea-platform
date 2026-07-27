import type { ReactNode } from 'react';

import Accordion from '@mui/material/Accordion';
import type { AccordionProps } from '@mui/material/Accordion';

import { combineSx } from '../lib/combineSx';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export type StyledAccordionProps = AccordionProps;

/**
 * The accordion panel shell: no shadow, no top divider between items.
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/accordion/StyledAccordion.jsx`.
 *
 * Deviation from the baseline: the baseline also carried a `showMode` prop
 * used only to interpolate padding into a
 * `'& .MuiButtonBase-root.MuiAccordionSummary-root'` selector that reached
 * DOWN into the child `AccordionSummary`'s internal DOM — banned outright by
 * `elitea/no-mui-internal-selector` (R-T6; see `StyledAccordionSummary`'s
 * doc comment for the full rationale and the `slotProps`-based fix). Once
 * that reach-down selector is gone, `StyledAccordion` has nothing left to
 * do with `showMode` — `StyledAccordionSummary` now owns that padding
 * directly on its own root, which is the component that actually renders
 * it. The prop is dropped here rather than threaded through unused.
 */
export function StyledAccordion({ sx, ...rest }: StyledAccordionProps): ReactNode {
  return (
    <Accordion
      sx={combineSx(
        {
          boxShadow: 'none',
          '&::before': { content: 'none' },
        },
        sx,
      )}
      {...rest}
    />
  );
}
