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
  /**
   * The publishing controls, as a SLOT rather than six props.
   *
   * Six booleans and callbacks side by side put this component over the §3.3
   * prop budget, and a slot is the better shape anyway: the toolbar's job is
   * where the controls sit, and it has no decision to make about publishing
   * that the publish surface has not already made. `SkillPublishControls` is
   * what goes here.
   */
  readonly publishing?: ReactNode;
}

export interface SkillPublishButtonsProps {
  /**
   * Whether the Publish control renders at all — the caller holds
   * `models.applications.skills.publish` and the version in view is a draft.
   *
   * `canPublish` is the narrower question: the platform is not refusing
   * publishes from this project. The two are separate fields because a control
   * that VANISHES when an operator throws a platform switch reads as a broken
   * page, while one that stays and explains itself reads as a policy. Both
   * answers come from the server; neither is enforcement.
   */
  readonly canShowPublish: boolean;
  readonly canPublish: boolean;
  readonly canUnpublish: boolean;
  readonly isUnpublishing: boolean;
  readonly onPublish: () => void;
  readonly onUnpublish: () => void;
}

export function SkillEditorToolbar({
  isDirty,
  isSaving,
  canDelete = false,
  onSave,
  onDiscard,
  onDelete,
  onExport,
  publishing,
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
      {publishing}
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
