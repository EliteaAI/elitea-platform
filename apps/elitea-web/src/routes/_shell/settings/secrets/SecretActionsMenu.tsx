/**
 * Row actions menu — edit, copy, hide, delete.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/secrets/
 * SecretActionsMenu.jsx`.  Uses MUI `<Menu>` + `<MenuItem>` (same as the
 * old app).  Text is i18n'd; icon references use inline SVG icons from
 * `@mui/icons-material`.
 */
import { memo } from 'react';

import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LockIcon from '@mui/icons-material/Lock';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/ui/lib/t';

export interface SecretActionsMenuProps {
  /** Currently-anchor element (`null` = menu closed). */
  anchorEl: HTMLElement | null;
  /** Row id for accessibility. */
  rowId: string;
  /** Whether this is a temporary new-secret row. */
  isNew: boolean;
  /** Whether this is a default (non-editable) secret. */
  isDefault: boolean;
  /** Close the menu. */
  onClose: () => void;
  /** Edit action. */
  onEdit: () => void;
  /** Hide action. */
  onHide: () => void;
  /** Delete action. */
  onDelete: () => void;
}

export const SecretActionsMenu = memo(function SecretActionsMenu({
  anchorEl,
  rowId,
  isNew,
  isDefault,
  onClose,
  onEdit,
  onHide,
  onDelete,
}: SecretActionsMenuProps) {
  return (
    <Menu
      id={`secret-actions-${rowId}`}
      anchorEl={anchorEl}
      open={!!anchorEl}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: styles.paper,
        },
        list: {
          'aria-labelledby': `secret-actions-${rowId}`,
        },
      }}
    >
      <MenuItem
        onClick={onEdit}
        disabled={isDefault}
        sx={styles.menuItem}
      >
        <EditIcon sx={styles.menuIcon} />
        <Typography variant="labelMedium" color="text.secondary">
          {t('entities.secret.actions.edit', 'Edit value')}
        </Typography>
      </MenuItem>
      {!isNew && (
        <MenuItem
          onClick={onHide}
          disabled={isDefault}
          sx={styles.menuItem}
        >
          <LockIcon sx={styles.menuIcon} />
          <Typography variant="labelMedium" color="text.secondary">
            {t('entities.secret.actions.hide', 'Hide')}
          </Typography>
        </MenuItem>
      )}
      <MenuItem
        onClick={onDelete}
        disabled={isDefault}
        sx={styles.menuItem}
      >
        <DeleteIcon sx={styles.menuIcon} />
        <Typography variant="labelMedium" color="text.secondary">
          {t('entities.secret.actions.delete', 'Delete')}
        </Typography>
      </MenuItem>
    </Menu>
  );
});

const styles: Record<string, SxProps<Theme>> = {
  paper: {
    '& .MuiList-root': {
      minWidth: '12.5rem',
      padding: '0.5rem 0',
    },
  },
  menuItem: {
    minHeight: '2.5rem',
    padding: '0.5rem 0.5rem 0.5rem 1.25rem',
  },
  menuIcon: {
    fontSize: '1rem',
    marginRight: '0.75rem',
  },
};
