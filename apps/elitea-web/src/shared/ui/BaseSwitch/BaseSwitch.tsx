import { forwardRef } from 'react';

import MuiSwitch, { type SwitchProps } from '@mui/material/Switch';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export type BaseSwitchProps = SwitchProps;

/**
 * Thin `forwardRef` wrapper over MUI's `Switch`, analogous to how
 * `BaseCheckbox` wraps MUI's `Checkbox`. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/switch/BaseSwitch.jsx`'s core
 * `<MuiSwitch>` render — the baseline component also bundled a
 * `label`/`infoTooltip`/`FormControlLabel` layout around the switch; that
 * chrome is a composition concern for a caller (the same way
 * `RadioButtonGroup` composes `BaseCheckbox` with `InfoLabelWithTooltip`
 * itself, rather than `BaseCheckbox` growing a label prop), not something
 * this primitive owns.
 *
 * All styling (on/off thumb and track colours, disabled state) lives in
 * `shared/brand/mui-overrides/MuiSwitch.ts` (R-T12) via `styleOverrides.root`
 * — unit T1 wired it unconditionally, replacing the baseline's
 * `variant="elitea"` gate (`Switch` has no typed `variant` prop, same reason
 * `MuiIconButton.ts` gave up its own `variant` gate). This file owns no
 * `sx`/`styled()` of its own, by design.
 *
 * Accessibility fix, not in the baseline (the same gap `BaseCheckbox` has
 * and fixes, `Switch` shares the same `SwitchBase` internals as
 * `Checkbox`/`Radio`): MUI 9's `Switch` renders `<span
 * class="MuiButtonBase-root"><input type="checkbox" role="switch"></span>`
 * — a bare `aria-label` prop (the natural call shape) lands on the outer,
 * roleless `<span>`, where axe's `aria-prohibited-attr` rule rejects it,
 * AND the actual `role="switch"` control is left with no accessible name
 * (`form elements must have labels`). Both were caught by this unit's own
 * Storybook a11y stories. Fixed the same way `BaseCheckbox` fixes it:
 * routing `aria-label`/`aria-labelledby` to the `input` slot.
 */
export const BaseSwitch = forwardRef<HTMLButtonElement, BaseSwitchProps>(function BaseSwitch(
  { size = 'small', 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, ...rest },
  ref,
) {
  const inputSlotProps = {
    ...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {}),
    ...(ariaLabelledBy !== undefined ? { 'aria-labelledby': ariaLabelledBy } : {}),
  };

  return (
    <MuiSwitch
      ref={ref}
      size={size}
      slotProps={{ input: inputSlotProps }}
      {...rest}
    />
  );
});
