// @ts-nocheck
/**
 * UsersParticipantDropdown — user participant dropdown entry point.
 *
 * Ported from `[fsd]/features/chat/participants/ui/UsersParticipantDropdown/index.jsx`.
 */
import { memo } from 'react';

import { Box, Paper, Popper } from '@mui/material';

import DropdownFooter from './DropdownFooter';
import UserMenu from './UserMenu';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UsersParticipantDropdownProps {
  anchorEl?: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  users: Record<string, unknown>[];
  onSelectUser?: (user: Record<string, unknown>) => void;
  currentUserId?: string;
}

/**
 * UsersParticipantDropdown component — entry point for the user participant dropdown.
 */
const UsersParticipantDropdown = memo((props: UsersParticipantDropdownProps): React.ReactElement | null => {
  const { anchorEl, open, onClose, users, onSelectUser, currentUserId } = props;

  return (
    <Popper open={open} anchorEl={anchorEl} placement="bottom-end" modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}>
      <Paper elevation={3} sx={{ maxHeight: 300, overflow: 'auto', minWidth: 200 }}>
        <Box sx={{ p: 1 }}>
          {users
            .filter((u) => u.id !== currentUserId)
            .map((u) => (
              <UserMenu key={u.id} participant={u} onSelect={() => onSelectUser?.(u)} onClose={onClose} />
            ))}
        </Box>
        <DropdownFooter />
      </Paper>
    </Popper>
  );
});

UsersParticipantDropdown.displayName = 'UsersParticipantDropdown';

export default UsersParticipantDropdown;
