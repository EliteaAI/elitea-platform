import type { MouseEvent, ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem, { type MenuItemProps } from '@mui/material/MenuItem';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { combineSx } from '../lib/combineSx';
import { CheckedIcon } from '../icons/checked-icon';

/** @public One option in a {@link SingleSelectProps.options} list. */
export interface SingleSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  disabled?: boolean;
}

/**
 * @public shared/ui component API — consumed once a features/widgets/pages
 * caller exists (none does yet in this pass).
 *
 * Extends `MenuItemProps` (minus `children`/`value`, which this component
 * owns) rather than declaring its own closed prop set, because MUI's
 * `Select` clones each of its DIRECT children and injects `onClick`/
 * `onMouseDown`/`onKeyUp`/`selected`/`role="option"`/`data-value` etc.
 * (verified against the installed `@mui/material@9.2.0`
 * `Select/SelectInput.js` source, not assumed) — this component must be
 * able to receive and forward every one of those.
 */
export interface SingleSelectMenuItemProps extends Omit<MenuItemProps, 'children' | 'value'> {
  option: SingleSelectOption;
  value: string;
  isSelected: boolean;
  /** Called instead of committing a (no-op) reselect when the already-selected option is clicked again. */
  onClear?: () => void;
}

/**
 * One row of a `SingleSelect`'s menu: label, optional leading icon and
 * description, and a trailing checkmark when selected. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/select/SingleSelectMenuItem.jsx`,
 * trimmed to this port's option shape (no per-item `canDelete`/avatar/
 * right-icon variants — see `SingleSelect`'s doc comment for the full list
 * of baseline features this port does not carry).
 *
 * Colours/hover/selected background live in
 * `shared/brand/mui-overrides/MuiMenuItem.ts` (R-T12, already wired); this
 * file owns only the row's content layout.
 */
export function SingleSelectMenuItem({
  option,
  value,
  isSelected,
  onClear,
  onClick,
  sx,
  ...rest
}: SingleSelectMenuItemProps): ReactNode {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLLIElement>) => {
      if (isSelected && onClear) {
        event.preventDefault();
        event.stopPropagation();
        onClear();
        return;
      }
      onClick?.(event);
    },
    [isSelected, onClear, onClick],
  );

  return (
    <MenuItem
      value={value}
      disabled={option.disabled}
      onClick={handleClick}
      sx={combineSx(rowSx, sx)}
      {...rest}
    >
      {option.icon && (
        <ListItemIcon sx={iconSx}>{option.icon}</ListItemIcon>
      )}
      {option.description ? (
        <Box sx={columnSx}>
          <Typography
            variant="labelMedium"
            color="text.secondary"
          >
            {option.label}
          </Typography>
          <Typography
            variant="bodySmall"
            color="text.secondary"
          >
            {option.description}
          </Typography>
        </Box>
      ) : (
        <ListItemText
          slotProps={{ primary: { variant: 'labelMedium' } }}
          sx={labelSx}
        >
          {option.label}
        </ListItemText>
      )}
      {isSelected && (
        <ListItemIcon sx={checkIconSx}>
          <CheckedIcon />
        </ListItemIcon>
      )}
    </MenuItem>
  );
}

const rowSx: SxProps<Theme> = {
  justifyContent: 'space-between',
  alignItems: 'center',
};

const iconSx: SxProps<Theme> = {
  minWidth: '1rem',
  width: '1rem',
  height: '1rem',
  marginRight: (theme: Theme) => theme.spacing(1),
  '& svg': { width: '1rem', height: '1rem' },
};

const checkIconSx: SxProps<Theme> = {
  minWidth: 0,
  marginLeft: (theme: Theme) => theme.spacing(1),
  display: 'flex',
  alignItems: 'center',
};

const labelSx: SxProps<Theme> = {
  whiteSpaceCollapse: 'preserve',
};

const columnSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: (theme: Theme) => theme.spacing(0.25),
  flex: 1,
  minWidth: 0,
};
