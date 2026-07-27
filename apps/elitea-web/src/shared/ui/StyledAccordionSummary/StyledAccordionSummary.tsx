import type { ReactNode } from 'react';

import AccordionSummary from '@mui/material/AccordionSummary';
import type { AccordionSummaryOwnerState, AccordionSummaryProps } from '@mui/material/AccordionSummary';
import type { Theme } from '@mui/material/styles';

import { combineSx } from '../lib/combineSx';

/** @public Which side the expand/collapse chevron sits on. */
export type AccordionShowMode = 'left' | 'right';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface StyledAccordionSummaryProps extends Omit<AccordionSummaryProps, 'slotProps'> {
  /** `'left'` (default): chevron leads, content flush left. `'right'`: standard trailing chevron. */
  showMode?: AccordionShowMode;
}

/**
 * The accordion header row: chevron + title (+ optional trailing action).
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/accordion/StyledAccordionSummary.jsx`.
 *
 * Deviation from the baseline (MUI-9.2 hazard): the baseline reaches into
 * ITS OWN internal DOM with `'& .MuiAccordionSummary-content'` and
 * `'& .MuiAccordionSummary-expandIconWrapper.Mui-expanded'` (plus an
 * `!important` on the content margin to out-fight MUI's own expanded-state
 * CSS). `elitea/no-mui-internal-selector` (R-T6) bans deep `.Mui*-*`
 * selectors outside `shared/brand/mui-overrides/` — a directory that owns
 * neither `MuiAccordion` nor `MuiAccordionSummary` (OWNERSHIP.md's 30-key
 * baseline set never included the accordion family; the baseline itself
 * never theme-overrides it, it sx-hacks every call site instead) — and
 * `elitea/no-important-sx` (R-T5) bans the `!important` outright.
 *
 * `AccordionSummary` in this MUI version exposes `content` and
 * `expandIconWrapper` as real, documented `slotProps` (verified against
 * `node_modules/@mui/material/AccordionSummary/AccordionSummary.js`:
 * `slotProps[name]` may be a function that receives the component's own
 * `ownerState`, which carries `expanded`). That is used here instead:
 *  - the expand-icon rotation reads `ownerState.expanded` directly, so no
 *    `.Mui-expanded` class match is needed;
 *  - the content margin is set once via `slotProps.content.sx`, which
 *    Emotion applies after the slot's own variant CSS — no `!important`
 *    required to win.
 */
export function StyledAccordionSummary({
  showMode = 'left',
  sx,
  expandIcon,
  ...rest
}: StyledAccordionSummaryProps): ReactNode {
  const isLeft = showMode === 'left';

  return (
    <AccordionSummary
      sx={combineSx(
        (theme: Theme) => ({
          flexDirection: isLeft ? 'row-reverse' : 'row',
          minHeight: '2.5rem',
          padding: isLeft ? theme.spacing(1) : `0 ${theme.spacing(1.5)}`,
        }),
        sx,
      )}
      expandIcon={expandIcon}
      slotProps={{
        content: {
          sx: (theme: Theme) => ({
            margin: 0,
            marginInlineStart: isLeft ? theme.spacing(1.5) : 0,
          }),
        },
        expandIconWrapper: (ownerState: AccordionSummaryOwnerState) => {
          // [MUI 9.2 type hazard] `AccordionSummaryOwnerState` is typed as
          // `Omit<AccordionSummaryProps, 'slots' | 'slotProps'>` — it omits
          // `expanded`, which `AccordionSummary.js` injects into the REAL
          // runtime ownerState object from `AccordionContext`
          // (`{ ...props, expanded, disabled, disableGutters }`) but which
          // was never added to the exported type. Verified against
          // `node_modules/@mui/material/AccordionSummary/AccordionSummary.js`
          // and `.d.ts` directly. The cast documents the gap at its one
          // read site instead of widening the callback's declared parameter
          // type (which `slotProps.expandIconWrapper`'s own contravariant
          // function-parameter position rejects).
          const isExpanded = (ownerState as AccordionSummaryOwnerState & { expanded?: boolean }).expanded;
          return { sx: { transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' } };
        },
      }}
      {...rest}
    />
  );
}
