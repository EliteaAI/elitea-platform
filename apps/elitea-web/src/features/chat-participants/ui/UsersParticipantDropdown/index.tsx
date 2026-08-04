// @ts-nocheck
/**
 * UsersParticipantDropdown — user participant dropdown entry point.
 *
 * Ported from `[fsd]/features/chat/participants/ui/UsersParticipantDropdown/index.jsx`.
 */
import { memo, useCallback, useMemo } from 'react';

import { Box, ClickAwayListener, Paper, Popper } from '@mui/material';

import DropdownFooter, { ALL_USERS_SENTINEL_ID } from './DropdownFooter';
import UserMenu, { participantName } from './UserMenu';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UsersParticipantDropdownProps {
  anchorEl?: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  users: Record<string, unknown>[];
  onSelectUser?: (user: Record<string, unknown>) => void;
  /** Per-row hover-revealed remove action (baseline: `index.jsx`'s `onDeleteUser` -> `UserMenu`'s `onRemoveOption`). Omit to hide the affordance. */
  onDeleteUser?: (user: Record<string, unknown>) => void;
  currentUserId?: string;
}

/**
 * UsersParticipantDropdown component — entry point for the user participant dropdown.
 */
const UsersParticipantDropdown = memo((props: UsersParticipantDropdownProps): React.ReactElement | null => {
  const { anchorEl, open, onClose, users, onSelectUser, onDeleteUser, currentUserId } = props;

  // Baseline: `UserMenu.jsx:15-19`'s alphabetical `options.sort(...)` by
  // display name — the new split-per-row `UserMenu` no longer owns the
  // list, so the sort moves up to this list-level component instead.
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => participantName(a).toLowerCase().localeCompare(participantName(b).toLowerCase())),
    [users],
  );

  // Baseline: `index.jsx:56-64`'s `ClickAwayListener` + `handleClose`, which
  // ignores clicks on the trigger itself (`anchorRef.current.contains(...)`)
  // so re-clicking the trigger doesn't immediately reopen the dropdown.
  const handleClickAway = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (anchorEl && anchorEl.contains(event.target as Node)) return;
      onClose();
    },
    [anchorEl, onClose],
  );

  // Baseline: `DropdownFooter.jsx`'s "All users" row, routed through the
  // SAME handler individual rows use (`index.jsx`'s `onSelectUser=
  // {onSelectParticipant}`), with a sentinel standing in for a real user row.
  const handleSelectAll = useCallback(() => {
    onSelectUser?.({ id: ALL_USERS_SENTINEL_ID });
    onClose();
  }, [onSelectUser, onClose]);

  return (
    <Popper open={open} anchorEl={anchorEl} placement="bottom-end" modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}>
      <ClickAwayListener onClickAway={handleClickAway}>
        <Paper elevation={3} sx={{ maxHeight: 300, overflow: 'auto', minWidth: 200 }}>
          <Box sx={{ p: 1 }}>
            {sortedUsers.map((u) => (
              <UserMenu
                key={u.id}
                participant={u}
                onSelect={() => onSelectUser?.(u)}
                onClose={onClose}
                disabled={u.id === currentUserId}
                {...(onDeleteUser ? { onDelete: () => onDeleteUser(u) } : {})}
              />
            ))}
          </Box>
          <DropdownFooter usersCount={sortedUsers.length} onSelectAll={handleSelectAll} />
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
});

UsersParticipantDropdown.displayName = 'UsersParticipantDropdown';

export default UsersParticipantDropdown;
