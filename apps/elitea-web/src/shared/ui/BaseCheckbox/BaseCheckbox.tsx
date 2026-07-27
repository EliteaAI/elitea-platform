import { forwardRef } from 'react';

import MuiCheckbox, { type CheckboxProps } from '@mui/material/Checkbox';
import MuiRadio, { type RadioProps } from '@mui/material/Radio';
import SvgIcon from '@mui/material/SvgIcon';

import { CheckboxCheckedIcon } from '../icons/checkbox-checked-icon';
import { CheckboxEmptyIcon } from '../icons/checkbox-empty-icon';
import { CheckboxIndeterminateIcon } from '../icons/checkbox-indeterminate-icon';

/** @public Exported for consumers that want the mode vocabulary by name (this unit's own call sites just pass `'checkbox'`/`'radio'` literals). */
export const CHECKBOX_MODES = {
  checkbox: 'checkbox',
  radio: 'radio',
} as const;

/** @public */
export type CheckboxMode = (typeof CHECKBOX_MODES)[keyof typeof CHECKBOX_MODES];

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface BaseCheckboxProps extends Omit<CheckboxProps, 'icon' | 'checkedIcon' | 'indeterminateIcon'> {
  /** `'checkbox'` (default) renders a real `<Checkbox>`; `'radio'` renders a `<Radio>`. */
  mode?: CheckboxMode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/**
 * A checkbox/radio wrapper with the app's outline-style checked/empty/
 * indeterminate icons. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/checkbox/BaseCheckbox.jsx`. Styling
 * (colours, size ladder) lives in `shared/brand/mui-overrides/MuiCheckbox.ts`
 * / `MuiRadio.ts` (R-T12).
 *
 * Accessibility fix, not in the baseline (which had the same gap): MUI 9's
 * `Checkbox`/`Radio` render `<span role=undefined class="MuiButtonBase-root">
 * <input type="checkbox"></span>` — passing `aria-label` as a bare prop (the
 * natural call shape, and what the baseline's own call sites do) lands it on
 * the outer, roleless `<span>`, where axe's `aria-prohibited-attr` rule
 * correctly rejects it, AND the actual form control is left with no
 * accessible name at all (`form elements must have labels`). Both were
 * caught by Storybook's a11y addon (`a11y.test: 'error'`) on this unit's
 * own stories — exactly the class of defect that gate exists to catch,
 * since it runs against real components, not code review. Fixed by routing
 * `aria-label`/`aria-labelledby` to the `input` slot, which is the element
 * that actually needs the accessible name.
 */
export const BaseCheckbox = forwardRef<HTMLButtonElement, BaseCheckboxProps>(function BaseCheckbox(
  { mode = CHECKBOX_MODES.checkbox, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, ...rest },
  ref,
) {
  const inputSlotProps = {
    ...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {}),
    ...(ariaLabelledBy !== undefined ? { 'aria-labelledby': ariaLabelledBy } : {}),
  };

  if (mode === CHECKBOX_MODES.radio) {
    return (
      <MuiRadio
        ref={ref}
        disableRipple
        slotProps={{ input: inputSlotProps }}
        {...(rest as RadioProps)}
      />
    );
  }

  return (
    <MuiCheckbox
      ref={ref}
      disableRipple
      icon={
        <SvgIcon
          component={CheckboxEmptyIcon}
          inheritViewBox
        />
      }
      checkedIcon={
        <SvgIcon
          component={CheckboxCheckedIcon}
          inheritViewBox
        />
      }
      indeterminateIcon={
        <SvgIcon
          component={CheckboxIndeterminateIcon}
          inheritViewBox
        />
      }
      slotProps={{ input: inputSlotProps }}
      {...rest}
    />
  );
});
