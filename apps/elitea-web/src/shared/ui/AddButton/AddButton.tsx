import { forwardRef, useCallback } from 'react';

import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import SvgIcon from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';

import { PlusIcon } from '../icons/plus-icon';
import { combineSx } from '../lib/combineSx';
import { t } from '../lib/t';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface AddButtonProps {
  onAdd?: () => void;
  /** Also doubles as the button's accessible name (it renders icon-only). */
  tooltip?: string;
  sx?: SxProps<Theme>;
}

/**
 * A small round icon button for "add" actions. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/button/AddButton.jsx`. Colour/geometry
 * come from `shared/brand/mui-overrides/MuiIconButton.ts` — this component
 * owns no `styled()`/variant styling of its own.
 *
 * Deviation from the baseline: `IconButton` has no typed `variant` prop
 * (`MuiIconButton.ts`'s own doc comment — the app's one icon-button skin
 * lives in `styleOverrides.root` plus per-`color` `variants`, not a
 * `variant="elitea"` gate), so this passes `color="primary"` only, not the
 * baseline's `variant="elitea" color="primary"`.
 *
 * Accessibility fix, not in the baseline: an icon-only `IconButton` wrapped
 * in a `Tooltip` has no accessible name until the tooltip is shown (a
 * `Tooltip` does not add `aria-label`) — axe's `button-name` rule catches
 * this. `tooltip` is reused as an explicit `aria-label` on the button
 * itself, same pattern `ViewRunHistoryButton` already used in the baseline.
 */
export const AddButton = forwardRef<HTMLButtonElement, AddButtonProps>(function AddButton(
  { onAdd, tooltip, sx },
  ref,
) {
  const label = tooltip ?? t('shared.ui.addButton.tooltip', 'Add');
  const handleClick = useCallback(() => {
    onAdd?.();
  }, [onAdd]);

  return (
    <Tooltip
      title={label}
      placement="top"
    >
      <IconButton
        ref={ref}
        disableRipple
        color="primary"
        aria-label={label}
        onClick={handleClick}
        sx={combineSx(sx)}
      >
        <SvgIcon
          component={PlusIcon}
          inheritViewBox
          sx={{ width: '1rem', height: '1rem', flexShrink: 0 }}
        />
      </IconButton>
    </Tooltip>
  );
});
