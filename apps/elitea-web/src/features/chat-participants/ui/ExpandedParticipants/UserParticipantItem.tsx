// @ts-nocheck
/**
 * UserParticipantItem — simplified user participant display.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ExpandedParticipants/UserParticipantItem.jsx`.
 */
import { memo } from 'react';

import { Box, Typography } from '@mui/material';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UserParticipantItemProps {
  participant: Record<string, unknown>;
  isActive?: boolean;
  onClick?: (participant: Record<string, unknown>) => void;
}

/**
 * UserParticipantItem — renders a simplified display for user participants.
 * Users don't have the same status icons/error states as entities (agents, toolkits, etc.).
 */
const UserParticipantItem = memo((props: UserParticipantItemProps): React.ReactElement => {
  const { participant, isActive, onClick } = props;

  const displayName = participant.entity_meta?.name || participant.meta?.user_name || 'User';

  return (
    <Box
      onClick={() => onClick?.(participant)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1,
        borderRadius: 1,
        cursor: 'pointer',
        background: isActive ? 'action.selected' : 'transparent',
        border: isActive ? '1px solid' : 'none',
        borderColor: 'split.hover',
        '&:hover': { background: 'action.hover' },
      }}
    >
      <Typography variant="bodyMedium" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayName}
      </Typography>
    </Box>
  );
});

UserParticipantItem.displayName = 'UserParticipantItem';

export default UserParticipantItem;
