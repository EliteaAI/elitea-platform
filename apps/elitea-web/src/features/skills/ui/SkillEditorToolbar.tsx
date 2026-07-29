import type { ReactNode } from 'react';

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import Box from '@mui/material/Box';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';

export interface SkillEditorToolbarProps {
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly canDelete?: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly onDelete?: () => void;
  readonly onExport?: () => void;
}

export function SkillEditorToolbar({
  isDirty,
  isSaving,
  canDelete = false,
  onSave,
  onDiscard,
  onDelete,
  onExport,
}: SkillEditorToolbarProps): ReactNode {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <BaseBtn
        variant="secondary"
        disabled={!isDirty || isSaving}
        onClick={onDiscard}
      >
        {t('skills.toolbar.discard', 'Discard')}
      </BaseBtn>
      <BaseBtn
        variant="contained"
        startIcon={<SaveOutlinedIcon />}
        disabled={!isDirty || isSaving}
        onClick={onSave}
      >
        {t('skills.toolbar.save', 'Save')}
      </BaseBtn>
      {onExport && (
        <BaseBtn
          variant="secondary"
          startIcon={<DownloadOutlinedIcon />}
          onClick={onExport}
        >
          {t('skills.toolbar.export', 'Export')}
        </BaseBtn>
      )}
      {canDelete && onDelete && (
        <BaseBtn
          variant="secondary"
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={onDelete}
        >
          {t('skills.toolbar.delete', 'Delete')}
        </BaseBtn>
      )}
    </Box>
  );
}
