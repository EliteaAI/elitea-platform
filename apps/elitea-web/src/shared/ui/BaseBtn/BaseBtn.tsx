import { forwardRef } from 'react';

import MuiButton, { type ButtonProps } from '@mui/material/Button';

/**
 * The button variant vocabulary (`theme.augment.d.ts`'s
 * `ButtonPropsVariantOverrides`, declared in full by unit T1).
 *
 * **All fourteen are wired.** This comment used to say only six were, and
 * told authors to avoid the rest — including `elitea`, the baseline's
 * single most-used variant. That stopped being true once unit S1 (Part B)
 * added the remaining eight; the advice outlived the gap and was steering
 * call sites onto MUI's built-ins instead of the brand vocabulary.
 *
 * What WAS still missing until recently is subtler and affected all
 * fourteen equally: `MuiButton` had no `styleOverrides.root`, so MUI's
 * stock shape showed through underneath every variant — uppercase text, a
 * 4px radius, the wrong font and padding. See
 * `shared/brand/mui-overrides/MuiButton.root.ts`. `variant="outlined"` is
 * the one value with no `variants` entry of its own; it now at least
 * inherits the correct root geometry.
 *
 * @public Documents the full vocabulary declared in `theme.augment.d.ts`,
 * for consumers built in a later unit — not referenced by name inside this
 * unit's own components, which pass the six wired variants as literals.
 */
export const BUTTON_VARIANTS = {
  elitea: 'elitea',
  contained: 'contained',
  secondary: 'secondary',
  text: 'text',
  special: 'special',
  alarm: 'alarm',
  auxiliary: 'auxiliary',
  icon: 'icon',
  iconCounter: 'iconCounter',
  maxi: 'maxi',
  iconLabel: 'iconLabel',
  tertiary: 'tertiary',
  neutral: 'neutral',
  positive: 'positive',
} as const;

/** @public Same vocabulary-documentation role as {@link BUTTON_VARIANTS}. */
export const BUTTON_COLORS = {
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  alarm: 'alarm',
} as const;

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export type BaseBtnProps = ButtonProps;

/**
 * Thin `forwardRef` wrapper over MUI's `Button`, matching the baseline
 * exactly. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/button/BaseBtn.jsx`. All styling
 * (colours, geometry, the six brand variants) lives in
 * `shared/brand/mui-overrides/MuiButton.ts` (R-T12) — this file owns no
 * `sx`/`styled()` of its own, by design.
 */
export const BaseBtn = forwardRef<HTMLButtonElement, BaseBtnProps>(function BaseBtn(
  { children, loadingPosition = 'end', ...rest },
  ref,
) {
  return (
    <MuiButton
      ref={ref}
      loadingPosition={loadingPosition}
      {...rest}
    >
      {children}
    </MuiButton>
  );
});
