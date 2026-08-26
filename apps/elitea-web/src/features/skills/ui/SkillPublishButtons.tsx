import type { ReactNode } from 'react';

import PublishOutlinedIcon from '@mui/icons-material/PublishOutlined';
import UnpublishedOutlinedIcon from '@mui/icons-material/UnpublishedOutlined';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';

import type { SkillPublishButtonsProps } from './SkillEditorToolbar';

/**
 * The two publishing controls, styled as the editor toolbar's siblings.
 *
 * A separate file from `SkillEditorToolbar` because the toolbar now takes them
 * as a slot: it decides where they sit, and nothing else about them.
 */
export function SkillPublishButtons({
  canShowPublish,
  canPublish,
  canUnpublish,
  isUnpublishing,
  onPublish,
  onUnpublish,
}: SkillPublishButtonsProps): ReactNode {
  return (
    <>
      {canShowPublish && (
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
      {canUnpublish && (
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
