/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * state/StateVariableIconButton.jsx` (64 lines) — unit A2j. A small square
 * icon button used throughout the State drawer (type selector trigger,
 * default-value affordance) with a shared "active/pressed border" visual.
 *
 * `borderRadius: '0.5rem'` -> `theme.vars.shape.radiusMd` (R-T10; 8px is an
 * exact match, no approximation). `height`/`width: '2rem'` stay literal rem
 * (R-T9 only governs margin/padding/gap, not box dimensions — confirmed
 * against `tools/lint-rules/rules/raw-px-spacing.mjs`'s `SPACING_KEYS`).
 * `!important` (baseline: every declaration in this file) is dropped per
 * R-T5 — a plain `sx`-generated class already outranks `IconButton`'s base
 * rule at equal specificity, the same reasoning already established by
 * `ui/nodes/RunStateNode.tsx`'s own `negativeButtonSvgSx` doc comment.
 * `IconButton` `variant="elitea"` (baseline) is dropped — this app's
 * `IconButton` has no typed `variant` prop, same gap `ui/nodes/BaseNode/
 * NodeCardHeader.tsx`'s doc comment already documents; its single skin
 * applies unconditionally. The baseline's `'& .MuiTouchRipple-root': {
 * display: 'none' }` (an internal-selector, R-T6-banned) is replaced with
 * the `disableRipple` prop — same "prop instead of selector" substitution
 * this codebase already uses consistently (e.g. `shared/ui/BaseCheckbox`,
 * `shared/ui/AddButton`) for the identical no-ripple intent.
 *
 * Accessibility fix, not in the baseline: MUI's `Tooltip` gives the wrapped
 * button an `aria-describedby` pointing at the popup, never an accessible
 * *name* — every caller here wraps a bare icon with no text content, so
 * without an explicit `aria-label` the button had no accessible name at
 * all. `aria-label={tooltip}` fixes it the same way `shared/ui/BaseSwitch`'s
 * own doc comment fixes the analogous gap for `Switch`.
 */
import type { MouseEvent, ReactNode } from 'react';

import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { combineSx } from '@/shared/ui/lib/combineSx';

/** @public */
export interface StateVariableIconButtonProps {
  readonly children: ReactNode;
  readonly tooltip: string;
  readonly onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  readonly isActive?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly sx?: SxProps<Theme> | undefined;
}

/**
 * A themed square `IconButton` with a hover/active border, wrapped in a
 * `Tooltip` that is suppressed while `disabled`.
 */
export function StateVariableIconButton(props: StateVariableIconButtonProps): ReactNode {
  const { children, tooltip, onClick, isActive = false, disabled = false, sx } = props;

  return (
    <Tooltip
      title={disabled ? '' : tooltip}
      placement="top"
    >
      <IconButton
        aria-label={tooltip}
        onClick={onClick}
        disabled={disabled}
        disableRipple
        sx={combineSx(iconButtonSx(isActive), sx)}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

function iconButtonSx(isActive: boolean): SxProps<Theme> {
  return (theme: Theme) => ({
    borderRadius: theme.vars.shape.radiusMd,
    height: '2rem',
    width: '2rem',
    backgroundColor: theme.vars.palette.background.userInputBackground,
    border: isActive
      ? `.0625rem solid ${theme.vars.palette.primary.pressed}`
      : '.0625rem solid transparent',
    '&:hover:not(:disabled)': {
      borderColor: isActive ? theme.vars.palette.primary.pressed : theme.vars.palette.border.lines,
      backgroundColor: theme.vars.palette.background.userInputBackground,
    },
    '&:focus, &:focus-visible': {
      borderColor: theme.vars.palette.primary.pressed,
      outline: 'none',
      backgroundColor: theme.vars.palette.background.userInputBackground,
    },
    '&.Mui-focusVisible': {
      backgroundColor: theme.vars.palette.background.userInputBackground,
    },
    '&:disabled': {
      border: '.0625rem solid transparent',
      '& svg': {
        color: theme.vars.palette.icon.fill.disabled,
      },
    },
  });
}
