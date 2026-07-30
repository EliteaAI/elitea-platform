// @ts-nocheck
/**
 * ExpandedParticipantsList — flat list renderer for expanded participant items.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ExpandedParticipants/ExpandedParticipantsList.jsx`.
 */
import { memo } from 'react';

import { Box } from '@mui/material';

import ParticipantItem from './ParticipantItem';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExpandedParticipantsListProps {
  participants: Record<string, unknown>[];
  collapsed?: boolean;
  disabledEdit?: boolean;
  onItemClick?: (participant: Record<string, unknown>) => void;
  onDelete?: (participant: Record<string, unknown>) => void;
  onEdit?: (participant: Record<string, unknown>) => void;
  editingToolkit?: Record<string, unknown>;
  mcpLoginSlot?: React.ReactNode;
  mcpLogoutSlot?: React.ReactNode;
  sharepointLoginSlot?: React.ReactNode;
}

/**
 * ExpandedParticipantsList component — renders a flat list of expanded ParticipantItems.
 */
const ExpandedParticipantsList = memo((props: ExpandedParticipantsListProps): React.ReactElement => {
  const {
    participants,
    collapsed,
    disabledEdit,
    onItemClick,
    onDelete,
    onEdit,
    editingToolkit,
    mcpLoginSlot,
    mcpLogoutSlot,
    sharepointLoginSlot,
  } = props;

  if (!participants?.length) return <Box sx={{ p: 1, textAlign: 'center', color: 'text.disabled' }}>No participants</Box>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {participants.map((participant, index) => (
        <ParticipantItem
          key={`${participant.id || index}-${participant.entity_meta?.id}`}
          participant={participant}
          collapsed={collapsed}
          disabledEdit={disabledEdit}
          onClickItem={onItemClick}
          onDelete={onDelete}
          onEdit={onEdit}
          editingToolkit={editingToolkit}
          mcpLoginSlot={mcpLoginSlot}
          mcpLogoutSlot={mcpLogoutSlot}
          sharepointLoginSlot={sharepointLoginSlot}
        />
      ))}
    </Box>
  );
});

ExpandedParticipantsList.displayName = 'ExpandedParticipantsList';

export default ExpandedParticipantsList;
