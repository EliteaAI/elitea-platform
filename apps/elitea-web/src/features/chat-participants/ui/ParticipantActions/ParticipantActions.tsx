// @ts-nocheck
/**
 * ParticipantActions — per-participant edit/delete action bar.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ParticipantActions/ParticipantActions.jsx`.
 *
 * Cross-cutting note: the old app imported `McpLogoutButton` from `features/mcp/ui`
 * and `McpLogInLink` from `features/mcp/ui`. New-app port uses slot props
 * (`mcpLogoutSlot`, `mcpLoginSlot`) supplied by the consumer.
 */
import { memo } from 'react';

import { Box } from '@mui/material';

import type { ReactNode } from 'react';

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
        <EditParticipantButton participant={participant} onEdit={onEdit} disabled={disabledEdit} />
      )}
      {showMcpActions && mcpLogoutSlot}
      {showMcpActions && mcpLoginSlot}
      <DeleteParticipantButton participant={participant} onDelete={onDelete} disabled={disabledDeleteButton} />
    </Box>
  );
});

ParticipantActions.displayName = 'ParticipantActions';

export default ParticipantActions;
