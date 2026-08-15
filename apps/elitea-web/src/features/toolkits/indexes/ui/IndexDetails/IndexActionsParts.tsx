import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import MuiButton from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { GearIcon } from '@/shared/ui/icons/gear-icon';
import { BaseSwitch } from '@/shared/ui/BaseSwitch';
import { DiscardButton } from '@/shared/ui/DiscardButton';

import type { ScheduleEntry } from '../../model/indexesStore';

/**
 * `IndexActions.tsx`'s (unit A4a) render-branch sub-components, split into
 * this sibling file — same naming convention as this app's already-landed
 * `features/toolkits/ui/ToolkitEditor.tsx` + `ToolkitEditorParts.tsx` split
 * — purely to keep `IndexActions.tsx` under the repo's 400-line budget
 * (R-eslint(max-lines)) after these were first extracted in-file to fix its
 * R-eslint(complexity) violation (25 > 12; each of these being its own
 * function scope keeps its internal ternaries/`||`/`&&` off `IndexActions`'s
 * own count). Zero behavior change from the single function this used to
 * be one contiguous part of — see `IndexActions.tsx`'s own doc comment for
 * the full DI/porting rationale.
 */

interface RemoveIndexButtonProps {
  readonly disabled: boolean;
  readonly isRemovingDisabled: boolean;
  readonly onDelete: () => void;
}

function RemoveIndexButton(props: RemoveIndexButtonProps): ReactNode {
  const { disabled, isRemovingDisabled, onDelete } = props;
  return (
    <Tooltip title={isRemovingDisabled ? t('features.toolkits.indexActions.removeNotSelected', '"Remove index" tool is not selected') : ''}>
      <Box component="span">
        <MuiButton
          variant="elitea"
          color="secondary"
          onClick={onDelete}
          disabled={disabled || isRemovingDisabled}
          sx={{ minWidth: '4.875rem' }}
        >
          {t('features.toolkits.indexActions.delete', 'Delete')}
        </MuiButton>
      </Box>
    </Tooltip>
  );
}

export interface IndexingInProgressActionsProps {
  readonly indexCouldBeStopped: boolean;
  readonly progressInvalidIndex: boolean;
  readonly onCancelIndexing: () => void;
  readonly isStoppingIndexing: boolean;
  readonly isActionsDisabled: boolean;
  readonly isRemovingDisabled: boolean;
  readonly onDelete: () => void;
}

export function IndexingInProgressActions(props: IndexingInProgressActionsProps): ReactNode {
  const { indexCouldBeStopped, progressInvalidIndex, onCancelIndexing, isStoppingIndexing, isActionsDisabled, isRemovingDisabled, onDelete } = props;
  if (indexCouldBeStopped || progressInvalidIndex) {
    return (
      <DiscardButton
        title={t('features.toolkits.indexActions.stop', 'Stop')}
        alertContent={t('features.toolkits.indexActions.stopConfirm', 'Are you sure to stop the indexing process?')}
        onDiscard={onCancelIndexing}
        discarding={isStoppingIndexing}
        color="alarm"
      />
    );
  }
  return (
    <RemoveIndexButton
      disabled={isActionsDisabled}
      isRemovingDisabled={isRemovingDisabled}
      onDelete={onDelete}
    />
  );
}

interface ScheduleSwitchProps {
  readonly enabled: boolean;
  readonly schedulingTooltipMessage: string | null;
  readonly scheduleConfigMessage: string | null;
  readonly onToggle: () => void;
  readonly onOpenModal: () => void;
}

function ScheduleSwitch(props: ScheduleSwitchProps): ReactNode {
  const { enabled, schedulingTooltipMessage, scheduleConfigMessage, onToggle, onOpenModal } = props;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '.5rem', padding: '0 .75rem', borderRight: (theme) => `1px solid ${theme.vars.palette.divider}` }}>
      <Tooltip title={schedulingTooltipMessage ?? ''}>
        <Box component="span">
          <BaseSwitch
            checked={enabled}
            onChange={onToggle}
            disabled={Boolean(schedulingTooltipMessage)}
          />
        </Box>
      </Tooltip>

      <Typography
        variant="bodyMedium"
        color="text.secondary"
      >
        {t('features.toolkits.indexActions.schedule', 'Schedule')}
      </Typography>

      <Tooltip title={scheduleConfigMessage ?? ''}>
        <Box
          data-testid="index-schedule-settings"
          onClick={() => (scheduleConfigMessage ? null : onOpenModal())}
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            width: '1.75rem',
            height: '1.75rem',
            borderRadius: (theme) => theme.vars.shape.radiusPill,
            cursor: scheduleConfigMessage ? 'default' : 'pointer',
            opacity: scheduleConfigMessage ? 0.5 : 1,
          }}
        >
          <GearIcon />
        </Box>
      </Tooltip>
    </Box>
  );
}

export interface EditModeActionsProps {
  readonly scheduleData: ScheduleEntry;
  readonly schedulingTooltipMessage: string | null;
  readonly scheduleConfigMessage: string | null;
  readonly onToggleSchedule: () => void;
  readonly onOpenScheduleModal: () => void;
  readonly isReindexDisabled: boolean;
  readonly isActionsDisabled: boolean;
  readonly isRemovingDisabled: boolean;
  readonly onIndexData: () => void;
  readonly onDelete: () => void;
}

export function EditModeActions(props: EditModeActionsProps): ReactNode {
  const {
    scheduleData,
    schedulingTooltipMessage,
    scheduleConfigMessage,
    onToggleSchedule,
    onOpenScheduleModal,
    isReindexDisabled,
    isActionsDisabled,
    isRemovingDisabled,
    onIndexData,
    onDelete,
  } = props;
  return (
    <>
      <ScheduleSwitch
        enabled={Boolean(scheduleData.enabled)}
        schedulingTooltipMessage={schedulingTooltipMessage}
        scheduleConfigMessage={scheduleConfigMessage}
        onToggle={onToggleSchedule}
        onOpenModal={onOpenScheduleModal}
      />
      <Tooltip title={isReindexDisabled ? t('features.toolkits.indexActions.reindexDisabled', 'Go to "Configuration" tab to reindex') : ''}>
        <Box component="span">
          <MuiButton
            variant="elitea"
            color="secondary"
            onClick={onIndexData}
            disabled={isActionsDisabled || isReindexDisabled}
            sx={{ minWidth: '4.875rem' }}
          >
            {t('features.toolkits.indexActions.reindex', 'Reindex')}
          </MuiButton>
        </Box>
      </Tooltip>

      <RemoveIndexButton
        disabled={isActionsDisabled}
        isRemovingDisabled={isRemovingDisabled}
        onDelete={onDelete}
      />
    </>
  );
}

export interface CreateModeActionsProps {
  readonly onDiscard: () => void;
  readonly isRunningTool: boolean;
  readonly isValidForm: boolean;
  readonly onIndexData: () => void;
}

export function CreateModeActions(props: CreateModeActionsProps): ReactNode {
  const { onDiscard, isRunningTool, isValidForm, onIndexData } = props;
  return (
    <>
      <DiscardButton
        title={t('features.toolkits.indexActions.cancel', 'Cancel')}
        onDiscard={onDiscard}
        disabled={isRunningTool}
      />
      <MuiButton
        variant="elitea"
        color="primary"
        disabled={!isValidForm || isRunningTool}
        onClick={onIndexData}
        sx={{ minWidth: '4.875rem' }}
      >
        {t('features.toolkits.indexActions.index', 'Index')}
      </MuiButton>
    </>
  );
}
