// @ts-nocheck
/**
 * ParticipantActions — per-participant edit/delete action bar.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ParticipantActions/ParticipantActions.jsx`.
 *
 * Cross-cutting note: the old app imported `McpLogoutButton` from `features/mcp/ui`
 * and `McpLogInLink` from `features/mcp/ui`. New-app port uses slot props
 * (`mcpLogoutSlot`, `mcpLoginSlot`) supplied by the consumer.
 *
 * FIXED regression: the old app computed a type-specific edit tooltip
 * ('Edit pipeline'/'Edit agent'/'Edit mcp'/'Edit toolkit') and passed it to
 * `EditParticipantButton` as its `tooltip` prop
 * (`ParticipantActions.jsx:37-45`); this port previously passed no
 * `tooltip` at all, so every participant type fell back to the same
 * generic "Edit" tooltip. Restored below via `editTooltip`.
 */
import { memo, useMemo } from 'react';

import { Box } from '@mui/material';

import type { ReactNode } from 'react';

import { t } from '@/shared/i18n';

import { ChatParticipantType } from '../../model/constants';

import DeleteParticipantButton from './DeleteParticipantButton';
import EditParticipantButton from './EditParticipantButton';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ParticipantActionsProps {
  participant: Record<string, unknown>;
  onEdit?: (participant: Record<string, unknown>) => void;
  onDelete?: (participant: Record<string, unknown>) => void;
  disabledEdit?: boolean;
  disabledDeleteButton?: boolean;
  showButtons?: boolean;
  showEditButton?: boolean;
  hasRemoteMcpLoggedIn?: boolean;
  serverUrl?: string;
  mcpLoginSlot?: ReactNode;
  mcpLogoutSlot?: ReactNode;
  sharepointLoginSlot?: ReactNode;
}

/**
 * Resolves the type-specific edit tooltip. Ported verbatim from the old
 * app's inline ternary (`ParticipantActions.jsx:37-45`).
 */
function resolveEditTooltip(participant: Record<string, unknown>): string {
  const entitySettings = participant.entity_settings as Record<string, unknown> | undefined;
  const meta = participant.meta as Record<string, unknown> | undefined;

  if (entitySettings?.agent_type === ChatParticipantType.Pipelines) {
    return t('chat-participants.tooltip.editPipeline', 'Edit pipeline');
  }
  if (participant.entity_name === ChatParticipantType.Applications) {
    return t('chat-participants.tooltip.editAgent', 'Edit agent');
  }
  if (meta?.mcp || entitySettings?.toolkit_type === 'mcp') {
    return t('chat-participants.tooltip.editMcp', 'Edit mcp');
  }
  return t('chat-participants.tooltip.editToolkit', 'Edit toolkit');
}

/**
 * ParticipantActions component — renders edit/delete buttons for a participant.
 * Memo'd for performance.
 */
const ParticipantActions = memo((props: ParticipantActionsProps): React.ReactElement | null => {
  const {
    showButtons,
    showEditButton,
    hasRemoteMcpLoggedIn,
    participant,
    onEdit,
    onDelete,
    disabledEdit,
    disabledDeleteButton,
    mcpLoginSlot,
    mcpLogoutSlot,
  } = props;

  const editTooltip = useMemo(() => resolveEditTooltip(participant), [participant]);

  if (!showButtons) return null;

  const showMcpActions = hasRemoteMcpLoggedIn || (mcpLoginSlot && mcpLogoutSlot);

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.5,
        alignItems: 'center',
        opacity: showButtons ? 1 : 0,
        transition: 'opacity 0.2s',
      }}
    >
      {showEditButton && (
        <EditParticipantButton participant={participant} onEdit={onEdit} disabled={disabledEdit} tooltip={editTooltip} />
      )}
      {showMcpActions && mcpLogoutSlot}
      {showMcpActions && mcpLoginSlot}
      <DeleteParticipantButton participant={participant} onDelete={onDelete} disabled={disabledDeleteButton} />
    </Box>
  );
});

ParticipantActions.displayName = 'ParticipantActions';

export default ParticipantActions;
