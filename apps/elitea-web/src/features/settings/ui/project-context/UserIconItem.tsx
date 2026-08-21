/**
 * UserIconItem — project icon item with a delete button.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/UserIconItem.jsx`.
 */
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import CloseIcon from '@mui/icons-material/Close';

import { BaseModal } from '@/shared/ui/BaseModal';
import { ProjectIconItem } from './ProjectIconItem';
import { t } from '@/shared/i18n';

export interface UserIconItemProps {
  isSelected: boolean;
  onClick?: () => void;
  onDelete?: () => void | Promise<void>;
  children: ReactNode;
}

export function UserIconItem({
  isSelected,
  onClick,
  onDelete,
  children,
}: UserIconItemProps) {

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
          <ProjectIconItem
            isSelected={isSelected}
            onClick={onClick}
          >
            {children}
          </ProjectIconItem>
        ) : (
          <ProjectIconItem isSelected={isSelected}>
            {children}
          </ProjectIconItem>
        )}
        {onDelete && (
          <IconButton
            color="error"
            aria-label={t('entities.projectContext.userIcon.deleteAriaLabel', 'Delete the icon')}
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
        title={t('entities.projectContext.userIconItem.confirmDeleteTitle', 'Warning')}
        content={t(
          'entities.projectContext.userIconItem.confirmDeleteMessage',
          'Are you sure to delete this icon?',
        )}
        actions={{
          confirmText: t('entities.projectContext.userIconItem.confirmDeleteConfirm', 'Delete'),
          cancelText: t('entities.projectContext.userIconItem.confirmDeleteCancel', 'Cancel'),
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
