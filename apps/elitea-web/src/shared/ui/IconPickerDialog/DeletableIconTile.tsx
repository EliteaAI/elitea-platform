/**
 * DeletableIconTile — an IconTile with a delete button and its confirmation.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/UserIconItem.jsx`.
 * See IconTile for why it lives in `shared/ui` rather than in the settings
 * feature it was first written for.
 */
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import CloseIcon from '@mui/icons-material/Close';

import { BaseModal } from '@/shared/ui/BaseModal';
import { IconTile } from './IconTile';
import { t } from '@/shared/i18n';

export interface DeletableIconTileProps {
  isSelected: boolean;
  onClick?: () => void;
  onDelete?: () => void | Promise<void>;
  children: ReactNode;
}

export function DeletableIconTile({
  isSelected,
  onClick,
  onDelete,
  children,
}: DeletableIconTileProps) {

  const [openAlert, setOpenAlert] = useState(false);

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setOpenAlert(true);
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    void onDelete?.();
    setOpenAlert(false);
  }, [onDelete]);

  const handleClose = useCallback(() => {
    setOpenAlert(false);
  }, []);

  return (
    <>
      <Box sx={sx.wrapper}>
        {onClick ? (
          <IconTile
            isSelected={isSelected}
            onClick={onClick}
          >
            {children}
          </IconTile>
        ) : (
          <IconTile isSelected={isSelected}>
            {children}
          </IconTile>
        )}
        {onDelete && (
          <IconButton
            color="error"
            aria-label={t('shared.iconPicker.tile.deleteAriaLabel', 'Delete the icon')}
            onClick={handleDeleteClick}
            sx={sx.deleteButton}
          >
            <CloseIcon />
          </IconButton>
        )}
      </Box>
      <BaseModal
        open={openAlert}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={t('shared.iconPicker.tile.confirmDeleteTitle', 'Warning')}
        content={t(
          'shared.iconPicker.tile.confirmDeleteMessage',
          'Are you sure to delete this icon?',
        )}
        actions={{
          confirmText: t('shared.iconPicker.tile.confirmDeleteConfirm', 'Delete'),
          cancelText: t('shared.iconPicker.tile.confirmDeleteCancel', 'Cancel'),
          alarm: true,
        }}
      />
    </>
  );
}

const sx: Record<string, SxProps<Theme>> = {
  wrapper: {
    position: 'relative' as const,
    overflow: 'visible' as const,
    '&:hover .deleteButton': { visibility: 'visible' as const },
  },
  deleteButton: {
    visibility: 'hidden' as const,
  },
};
