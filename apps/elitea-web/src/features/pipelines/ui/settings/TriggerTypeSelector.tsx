import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import LinkIcon from '@mui/icons-material/Link';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { InfoLabelWithTooltip } from '@/shared/ui/InfoLabelWithTooltip';
import { SingleSelect } from '@/shared/ui/SingleSelect';
import { ClockIcon } from '@/shared/ui/icons/clock-icon';

import { usePipelineTrigger } from '../../api/usePipelineTrigger';
import { PipelineScheduleModal } from './PipelineScheduleModal';
import { PipelineWebhookModal } from './PipelineWebhookModal';
import {
  TRIGGER_OPTIONS,
  TRIGGER_TYPES,
  buildTriggerTooltip,
  computeHasInteractiveElements,
  parseTriggerSchedule,
  useAutoResetTriggerOnInteractive,
  useTriggerActions,
} from './triggerTypeSelector.lib';

export interface TriggerTypeSelectorProps {
  readonly disabled?: boolean | undefined;
  readonly projectId?: string;
  readonly versionId?: number;
  /** The SAVED version's YAML (`version_details.instructions`) -- see `computeHasInteractiveElements`'s own doc comment for why this is not the editor's live working copy. */
  readonly versionInstructions?: string;
  readonly onNotifySuccess?: (message: string) => void;
  readonly onNotifyError?: (message: string) => void;
}

const containerSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%', padding: '0.5rem 1rem', boxSizing: 'border-box' };
const selectWrapperSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: '0.5rem' };
const selectSx: SxProps<Theme> = { flex: 1, marginBottom: '0' };
const iconStyle: SxProps<Theme> = { width: '1rem', height: '1rem' };
function scheduleButtonSx(theme: Theme) {
  return { padding: '0.25rem', color: theme.vars.palette.icon.fill.secondary, '&:hover': { color: theme.vars.palette.primary.main } };
}

interface TriggerActionButtonProps {
  readonly tooltip: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly icon: ReactNode;
}

function TriggerActionButton({ tooltip, onClick, disabled, icon }: TriggerActionButtonProps): ReactNode {
  return (
    <Tooltip
      title={tooltip}
      placement="top"
    >
      <IconButton
        sx={scheduleButtonSx}
        onClick={onClick}
        disabled={disabled}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/TriggerTypeSelector.jsx` (unit A2h). `PipelineScheduleModal`/
 * `PipelineWebhookModal` are this same sub-unit's owned siblings, imported
 * directly (intra-slice, no restriction). Constants, pure helpers, and the
 * two data-mutating hooks this component composes live in
 * `./triggerTypeSelector.lib.ts` -- split out purely for the §3.5 400-line
 * budget (see that file's own doc comment).
 *
 * DEVIATIONS FROM BASELINE:
 *  1. `useFormikContext()` (`values?.version_details.{id,instructions}`) ->
 *     explicit `versionId`/`versionInstructions` props (no Formik).
 *  2. `useSelectedProject()` -> explicit `projectId` prop (this slice's own
 *     `useSelectedProjectId` hook is available too, but the caller already
 *     has `versionId` from the same source, so both are passed the same
 *     way rather than mixing an ambient hook with an explicit prop for the
 *     other).
 *  3. `useGetPipelineTriggerQuery`/`useUpdatePipelineTriggerMutation`
 *     (RTK Query) -> `../../api/usePipelineTrigger.ts` (this sub-unit's own
 *     TanStack-Query-based port -- see that file's doc comment for the
 *     generated-client `useQuery`-shaped-write deviation).
 *  4. `useToast()` -> `onNotifySuccess`/`onNotifyError` callback props, the
 *     established "no global toast hook exists" convention this app's
 *     other ported components already use (e.g. `NodeCardHeader.tsx`'s own
 *     doc comment).
 */
export function TriggerTypeSelector(props: TriggerTypeSelectorProps): ReactNode {
  const { disabled = false, projectId, versionId, versionInstructions, onNotifySuccess, onNotifyError } = props;

  const hasInteractiveElements = useMemo(() => computeHasInteractiveElements(versionInstructions), [versionInstructions]);

  const availableTriggerOptions = useMemo(
    () => (hasInteractiveElements ? TRIGGER_OPTIONS.filter(option => option.value === TRIGGER_TYPES.chat_message) : TRIGGER_OPTIONS),
    [hasInteractiveElements],
  );

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const { trigger: triggerData, isFetching, updateTrigger } = usePipelineTrigger(projectId, versionId);

  const currentTriggerType = triggerData?.type ?? TRIGGER_TYPES.chat_message;
  const schedule = useMemo(() => parseTriggerSchedule(triggerData?.schedule), [triggerData?.schedule]);

  useAutoResetTriggerOnInteractive({ hasInteractiveElements, currentTriggerType, projectId, versionId, updateTrigger, onNotifySuccess, onNotifyError });

  const { handleTriggerTypeChange, handleScheduleSubmit, handleScheduleIconClick, handleWebhookIconClick, handleWebhookSubmit } = useTriggerActions({
    currentTriggerType,
    currentWebhookType: schedule.webhookType,
    secretValue: schedule.secretValue,
    updateTrigger,
    setIsUpdating,
    setIsScheduleModalOpen,
    setIsWebhookModalOpen,
    onNotifySuccess,
    onNotifyError,
  });

  const isLoading = isFetching || isUpdating;
  const triggerTooltip = useMemo(() => buildTriggerTooltip(hasInteractiveElements), [hasInteractiveElements]);

  return (
    <Box sx={containerSx}>
      <InfoLabelWithTooltip
        label={t('pipelines.triggerTypeSelector.label', 'Trigger')}
        tooltip={triggerTooltip}
        variant="labelSmall"
        iconSize={14}
      />

      <Box sx={selectWrapperSx}>
        <SingleSelect
          sx={selectSx}
          value={currentTriggerType}
          onChange={value => {
            void handleTriggerTypeChange(value);
          }}
          options={availableTriggerOptions}
          disabled={disabled || isLoading}
        />

        {currentTriggerType === TRIGGER_TYPES.schedule && (
          <TriggerActionButton
            tooltip={t('pipelines.triggerTypeSelector.editSchedule', 'Edit schedule')}
            onClick={handleScheduleIconClick}
            disabled={disabled || isLoading}
            icon={<ClockIcon style={{ width: '1rem', height: '1rem' }} />}
          />
        )}

        {currentTriggerType === TRIGGER_TYPES.webhook && (
          <TriggerActionButton
            tooltip={t('pipelines.triggerTypeSelector.editWebhook', 'Edit webhook settings')}
            onClick={() => {
              void handleWebhookIconClick();
            }}
            disabled={disabled || isLoading}
            icon={<LinkIcon sx={iconStyle} />}
          />
        )}
      </Box>

      <PipelineScheduleModal
        open={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        onSubmit={cronExpression => {
          void handleScheduleSubmit(cronExpression);
        }}
        cron={schedule.cron}
        isLoading={isUpdating}
      />

      <PipelineWebhookModal
        open={isWebhookModalOpen}
        onClose={() => setIsWebhookModalOpen(false)}
        onSubmit={(webhookType, newSecretValue) => {
          void handleWebhookSubmit(webhookType, newSecretValue);
        }}
        webhookType={schedule.webhookType}
        webhookUrl={schedule.webhookUrl}
        secretValue={schedule.secretValue}
        secretHeader={schedule.secretHeader}
        secretInstructions={schedule.secretInstructions}
        isLoading={isUpdating}
        onNotify={onNotifySuccess}
      />
    </Box>
  );
}
