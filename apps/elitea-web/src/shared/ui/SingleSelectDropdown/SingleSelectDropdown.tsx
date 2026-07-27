import type { ReactNode } from 'react';

import type { SingleSelectMenuItemProps } from '../SingleSelectMenuItem';
import { SingleSelectMenuItem } from '../SingleSelectMenuItem';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export type SingleSelectDropdownProps = SingleSelectMenuItemProps;

/**
 * The adapter between MUI `Select`'s child-cloning contract and the
 * presentational `SingleSelectMenuItem`. `Select/SelectInput.js`
 * (`@mui/material@9.2.0`, verified against the installed source) clones
 * each DIRECT child of `<Select>` — never a grandchild — injecting
 * `onClick`/`onMouseDown`/`onPointerDown`/`onMouseUp`/`onKeyUp`/`onKeyDown`/
 * `role="option"`/`selected`/`data-value`. `SingleSelect` therefore renders
 * one `SingleSelectDropdown` per option as a direct `<Select>` child (never
 * nested further); this component is the seam Select's clone actually
 * lands on.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/shared/ui/select/
 * SingleSelectDropdown.jsx`, which additionally dispatched to a search-bar
 * row and an "add new" action row (both driven by app-level constants this
 * `shared/ui` component cannot reach — see `SingleSelect`'s doc comment).
 * Kept as its own file, matching the baseline's split 1:1, so those row
 * kinds have a natural home if a later unit adds them back; today it stamps
 * the stable `data-testid="select-option-<value>"` test hook and forwards
 * everything else to `SingleSelectMenuItem` unchanged.
 */
export function SingleSelectDropdown({ option, ...rest }: SingleSelectDropdownProps): ReactNode {
  return (
    <SingleSelectMenuItem
      option={option}
      data-testid={`select-option-${option.value}`}
      {...rest}
    />
  );
}
