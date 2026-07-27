import type { EliteaComponents } from '../theme-types';

/**
 * `MuiTypography` (R-T12, R-C2). Not one of the baseline's 30 keys (the
 * baseline never configures this key at all, per T2 §3 — which is exactly
 * how it ends up with "1 `<h1>` and 0 `<h2>`-`<h6>` in 950 files"). Added
 * here — colour-free, `defaultProps` only — purely to satisfy R-C2:
 * `headingLarge`/`headingMedium`/`headingSmall` must render as real heading
 * elements, not `<span>`.
 *
 * `h1`/`h2`/`h3` is a size-ordered default mapping (`headingLarge` is the
 * biggest of the three, so it maps to the highest-ranked tag); any call
 * site embedded in a context where that specific level is wrong for the
 * surrounding document outline can still override it locally with the
 * standard `component="h4"` prop — `variantMapping` only sets the default.
 */
export const MuiTypography: EliteaComponents['MuiTypography'] = {
  defaultProps: {
    variantMapping: {
      headingLarge: 'h1',
      headingMedium: 'h2',
      headingSmall: 'h3',
    },
  },
};
