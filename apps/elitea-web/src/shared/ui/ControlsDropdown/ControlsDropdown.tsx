import type { MouseEvent, ReactNode } from 'react';
import { Fragment, useCallback, useId, useState } from 'react';

// [S1-D] Interim icon, same class of gap BaseModal.tsx documents for
// `CloseIcon`: the baseline's `DotsMenuIcon` (`@/components/Icons/DotsMenuIcon`)
// is not part of S2's ported `shared/ui/icons/` set (no `dots-menu-icon.tsx`
// exists there — verified by directory listing). `MoreVert` is the standard
// @mui/icons-material kebab-menu glyph (R-I1-compliant single-icon import).
// TODO(S2 follow-up): swap for `@/shared/ui/icons/dots-menu-icon` once it lands.
import MoreVertIcon from '@mui/icons-material/MoreVert';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '../lib/t';

/** @public Options for a row that asks for confirmation before acting, instead of firing `onClick` immediately. */
export interface ControlsDropdownConfirmConfig {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

/**
 * @public A row with no further nesting. Used both for ordinary top-level
 * rows and for every row inside a submenu (submenus are exactly one level
 * deep — see {@link ControlsDropdownItem}).
 */
export interface ControlsDropdownLeafItem {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  confirm?: ControlsDropdownConfirmConfig;
}

/** @public A top-level row, optionally opening one nested flyout of leaf rows. */
export interface ControlsDropdownItem extends ControlsDropdownLeafItem {
  items?: ControlsDropdownLeafItem[];
}

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface ControlsDropdownProps {
  items: ControlsDropdownItem[];
  /** Defaults to a kebab (`MoreVert`) icon. */
  triggerIcon?: ReactNode;
  triggerAriaLabel?: string;
  disabled?: boolean;
  id?: string;
  sx?: SxProps<Theme>;
}

interface SubmenuState {
  key: string;
  anchorEl: HTMLElement;
}

function hasNestedItems(row: ControlsDropdownItem | ControlsDropdownLeafItem): row is ControlsDropdownItem {
  return 'items' in row && Array.isArray(row.items) && row.items.length > 0;
}

/**
 * The app's "kebab menu" trigger: an icon button that opens a `Menu`, whose
 * rows can optionally open one nested flyout (`items`) or swap themselves
 * for an inline Cancel/Confirm pair (`confirm`) instead of acting
 * immediately.
 *
 * Re-derived from `apps/elitea-ui/src/components/DotMenu.jsx`'s BEHAVIOR
 * (menu/submenu/inline-confirm), not ported line-by-line, per this unit's
 * brief — `DotMenu` is read-only reference material, never imported. The
 * baseline's `ControlsDropdown.jsx` delegated entirely to `DotMenu`
 * (multi-column layouts, an `AlertDialogV2`/`Modal.DeleteEntityModal`
 * confirmation flow, Redux-adjacent `useDeleteConfirmationDisabled`); this
 * port drops the modal confirmation route in favour of a real *inline*
 * confirm (`ListSubheader` message + two `MenuItem`s replacing the row in
 * place, per the unit brief's "optional inline delete-confirmation state"),
 * and drops multi-column layout — neither is needed by a self-contained
 * `shared/ui` component with no Redux/features access. It is intentionally
 * NOT a thin wrapper over `DotMenu`: this component owns its own
 * `Menu`/`MenuItem`/`MenuList` composition (the MUI 9.2 primitives S1
 * already themed via `shared/brand/mui-overrides/{MuiMenu,MuiMenuList,
 * MuiMenuItem}.ts`), with no Redux/features import anywhere in the file.
 *
 * Keyboard/focus: arrow-key traversal, `Home`/`End`, typeahead and `Escape`
 * come from MUI's own `Menu`/`MenuList` — none of that is hand-rolled here.
 * The inline confirm pair renders as two more `MenuItem`s (via a `Fragment`,
 * not a wrapping `<div>`, so they stay direct DOM children of the list and
 * remain reachable by the same arrow-key traversal) rather than a modal, so
 * focus never leaves the open menu.
 */
export function ControlsDropdown({
  items,
  triggerIcon,
  triggerAriaLabel,
  disabled,
  id,
  sx,
}: ControlsDropdownProps): ReactNode {
  const generatedId = useId();
  const baseId = id ?? `controls-dropdown-${generatedId}`;
  const menuId = `${baseId}-menu`;
  const triggerId = `${baseId}-trigger`;

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [submenu, setSubmenu] = useState<SubmenuState | null>(null);

  const open = Boolean(anchorEl);

  const handleTriggerClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
    setConfirmingKey(null);
    setSubmenu(null);
  }, []);

  const handleSubmenuClose = useCallback(() => {
    setSubmenu(null);
    setConfirmingKey(null);
  }, []);

  const handleLeafActivate = useCallback(
    (row: ControlsDropdownLeafItem) => {
      row.onClick?.();
      handleClose();
    },
    [handleClose],
  );

  const handleConfirm = useCallback(
    (confirm: ControlsDropdownConfirmConfig) => {
      confirm.onConfirm();
      handleClose();
    },
    [handleClose],
  );

  const handleCancelConfirm = useCallback(() => {
    setConfirmingKey(null);
  }, []);

  const renderRow = useCallback(
    (row: ControlsDropdownItem | ControlsDropdownLeafItem): ReactNode => {
      if (confirmingKey === row.key && row.confirm) {
        const { confirm } = row;
        return (
          <Fragment key={row.key}>
            {/* `role="presentation"` (R-C1 fix, caught by the a11y gate): a
                bare `ListSubheader` renders an unadorned `<li>`, which axe's
                `aria-required-children` correctly rejects as a direct child
                of `role="menu"` (ARIA's menu pattern only allows menuitem
                variants or a group as children). Marking it presentational
                removes it from that structural check while keeping the
                message text itself in the accessible tree, read in DOM
                order right before the Cancel/Confirm pair. */}
            <ListSubheader
              disableSticky
              role="presentation"
            >
              {confirm.message}
            </ListSubheader>
            <MenuItem onClick={handleCancelConfirm}>
              {confirm.cancelLabel ?? t('shared.ui.controlsDropdown.cancel', 'Cancel')}
            </MenuItem>
            <MenuItem onClick={() => handleConfirm(confirm)}>
              {confirm.confirmLabel ?? t('shared.ui.controlsDropdown.confirm', 'Delete')}
            </MenuItem>
          </Fragment>
        );
      }

      const nested = hasNestedItems(row);

      return (
        <MenuItem
          key={row.key}
          disabled={row.disabled}
          aria-haspopup={nested ? 'true' : undefined}
          onClick={(event: MouseEvent<HTMLLIElement>) => {
            if (nested) {
              setSubmenu({ key: row.key, anchorEl: event.currentTarget });
              return;
            }
            if (row.confirm) {
              setConfirmingKey(row.key);
              return;
            }
            handleLeafActivate(row);
          }}
        >
          {row.icon && <ListItemIcon>{row.icon}</ListItemIcon>}
          <ListItemText>{row.label}</ListItemText>
        </MenuItem>
      );
    },
    [confirmingKey, handleCancelConfirm, handleConfirm, handleLeafActivate],
  );

  if (items.length === 0) {
    return null;
  }

  const activeParent = submenu ? items.find((row) => row.key === submenu.key) : undefined;

  return (
    <>
      <IconButton
        id={triggerId}
        color="tertiary"
        disabled={disabled}
        aria-label={triggerAriaLabel ?? t('shared.ui.controlsDropdown.trigger', 'More actions')}
        aria-haspopup="true"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open ? 'true' : undefined}
        onClick={handleTriggerClick}
        sx={sx}
      >
        {triggerIcon ?? <MoreVertIcon />}
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ list: { 'aria-labelledby': triggerId } }}
      >
        {items.map(renderRow)}
      </Menu>
      {submenu && activeParent?.items && (
        <Menu
          anchorEl={submenu.anchorEl}
          open
          onClose={handleSubmenuClose}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          {activeParent.items.map(renderRow)}
        </Menu>
      )}
    </>
  );
}
