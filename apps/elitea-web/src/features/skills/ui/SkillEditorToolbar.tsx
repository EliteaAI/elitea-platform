import type { ReactNode } from 'react';

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import PublishOutlinedIcon from '@mui/icons-material/PublishOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import UnpublishedOutlinedIcon from '@mui/icons-material/UnpublishedOutlined';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

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
   * Whether the Publish control renders at all — the caller holds
   * `models.applications.skills.publish` and the version in view is a draft.
   *
   * `canPublish` is the narrower question: the platform is not refusing
   * publishes from this project. The two are separate props because a control
   * that VANISHES when an operator throws a platform switch reads as a broken
   * page, while one that stays and explains itself reads as a policy. Both
   * answers come from the server; neither is enforcement.
   */
  readonly canShowPublish?: boolean;
  readonly canPublish?: boolean;
  readonly canUnpublish?: boolean;
  readonly isUnpublishing?: boolean;
  readonly onPublish?: () => void;
  readonly onUnpublish?: () => void;
}

/**
 * The two publishing controls, split out of `SkillEditorToolbar` to keep that
 * function inside the §3.5 complexity budget — the same split
 * `shared/ui/BaseModal` makes for `ModalActions`, and for the same reason.
 */
function PublishControls({
  canShowPublish,
  canPublish,
  canUnpublish,
  isUnpublishing,
  onPublish,
  onUnpublish,
}: {
  readonly canShowPublish: boolean;
  readonly canPublish: boolean;
  readonly canUnpublish: boolean;
  readonly isUnpublishing: boolean;
  readonly onPublish: (() => void) | undefined;
  readonly onUnpublish: (() => void) | undefined;
}): ReactNode {
  return (
    <>
      {canShowPublish && onPublish && (
        <Tooltip title={canPublish ? '' : t(
                  'skills.toolbar.publishBlocked',
                  'Skill publishing is blocked on this deployment for this project. An administrator can change that on Features, under Skill Publishing.',
                )}>
          {/* A disabled button fires no events, so the tooltip needs a wrapper
              that does — otherwise the explanation for the disabled state is
              unreachable, which is the same as not having one. */}
          <Box component="span">
            <BaseBtn
              variant="contained"
              startIcon={<PublishOutlinedIcon />}
              disabled={!canPublish}
              onClick={onPublish}
            >
              {t('skills.toolbar.publish', 'Publish')}
            </BaseBtn>
          </Box>
        </Tooltip>
      )}
      {canUnpublish && onUnpublish && (
        <BaseBtn
          variant="secondary"
          startIcon={<UnpublishedOutlinedIcon />}
          disabled={isUnpublishing}
          onClick={onUnpublish}
        >
          {t('skills.toolbar.unpublish', 'Unpublish')}
        </BaseBtn>
      )}
    </>
  );
}

export function SkillEditorToolbar({
  isDirty,
  isSaving,
  canDelete = false,
  onSave,
  onDiscard,
  onDelete,
  onExport,
  canShowPublish = false,
  canPublish = false,
  canUnpublish = false,
  isUnpublishing = false,
  onPublish,
  onUnpublish,
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
      <PublishControls
        canShowPublish={canShowPublish}
        canPublish={canPublish}
        canUnpublish={canUnpublish}
        isUnpublishing={isUnpublishing}
        onPublish={onPublish}
        onUnpublish={onUnpublish}
      />
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
