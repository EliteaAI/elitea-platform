import { forwardRef } from 'react';

import MuiButton, { type ButtonProps } from '@mui/material/Button';

/**
 * The button variant vocabulary (`theme.augment.d.ts`'s
 * `ButtonPropsVariantOverrides`, declared in full by unit T1).
 *
 * **Parity gap, flagged for follow-up:** only six of these —
 * `special`/`contained`/`secondary`/`iconCounter`/`auxiliary`/`maxi` — have
 * a `styleOverrides`/`variants` entry in
 * `shared/brand/mui-overrides/MuiButton.ts` (T1's OWNERSHIP.md scopes its
 * wiring to exactly those six, "the six variants that carried the §4.1
 * Blocker-1 hard-coded accents"). The baseline's single most-used variant,
 * `elitea` (always paired with a `color` prop — `primary`/`secondary`/
 * `tertiary`/`alarm`), plus `alarm`/`text`/`icon`/`iconLabel`/`tertiary`/
 * `neutral`/`positive`, type-check (the names are declared) but render with
 * **no custom styling** — MuiButton.ts is one of the two files S1 was told
 * not to touch. Every `shared/ui` component in this unit therefore uses
 * only the six wired variants (or MUI's built-in `text`/`outlined`), never
 * `elitea`/`alarm`/etc. This needs a decision: either T1 extends
 * `MuiButton.ts` with the remaining variants, or S1 gets explicit sign-off
 * to add them in a follow-up change.
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
