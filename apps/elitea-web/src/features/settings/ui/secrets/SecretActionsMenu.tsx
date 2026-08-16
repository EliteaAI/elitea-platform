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

import { t } from '@/shared/i18n';
import type { SecretPermissions } from '../../lib/secrets/secretPermissions';

export interface SecretActionsMenuProps {
  /** Currently-anchor element (`null` = menu closed). */
  anchorEl: HTMLElement | null;
  /** Row id for accessibility. */
  rowId: string;
  /** Whether this is a temporary new-secret row. */
  isNew: boolean;
  /** Whether this is a default (non-editable) secret. */
  isDefault: boolean;
  /**
   * What the caller may do. Each item below is omitted when its permission is
   * false (#402).
   *
   * Omitted, not disabled. A disabled item still tells the reader the action
   * exists and gives no reason it is unavailable, and the three actions here
   * fail in three different ways for a caller without the grant: delete and
   * hide return 403 with NO toast at all, and edit fetches the plaintext first,
   * so its 403 arrives before the menu closes and the item simply looks dead.
   */
  permissions: SecretPermissions;
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
  permissions,
  onClose,
  onEdit,
  onHide,
  onDelete,
}: SecretActionsMenuProps) {
  // The edit flow reveals the plaintext before it opens the editor
  // (`entities/secret/model/hooks.ts`), so it needs BOTH strings. Without
  // `.unsecret` the reveal 403s and the editor never opens.
  const canEditValue = permissions.canEdit && permissions.canUnsecret;

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
      {canEditValue && (
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
      )}
      {!isNew && permissions.canHide && (
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
      {permissions.canDelete && (
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
      )}
    </Menu>
  );
});

const styles: Record<string, SxProps<Theme>> = {
  paper: {
    // List root minWidth and padding handled by MuiList override (mui-overrides/MuiList.ts).
  },
  menuItem: {
    minHeight: '2.5rem',
    padding: '0.5rem 0.5rem 0.5rem 1.25rem',
  },
  menuIcon: ({ typography }) => ({
    fontSize: typography.headingMedium.fontSize,
    marginRight: '0.75rem',
  }),
};
