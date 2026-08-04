// @ts-nocheck
/**
 * UserMenu — single user item in the participant dropdown.
 *
 * Ported from `[fsd]/features/chat/participants/ui/UsersParticipantDropdown/UserMenu.jsx`.
 */
import { memo } from 'react';

import { Box, IconButton, Typography } from '@mui/material';

import PersonIcon from '@mui/icons-material/Person';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';

import { t } from '@/shared/i18n';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UserMenuProps {
  participant: Record<string, unknown>;
  onSelect: () => void;
  onClose: () => void;
  /**
   * Non-interactive row (baseline: `UserMenu.jsx:33`'s `selectable &&
   * user.entity_meta?.id !== currentUserId` — the signed-in user is shown,
   * disabled, not removed from the list).
   */
  disabled?: boolean;
  /**
   * Hover-revealed remove action (baseline: `UserMenu.jsx:78-83`'s
   * `DeleteParticipantButton`, wired to `onRemoveOption`). Omit to hide the
   * affordance entirely.
   */
  onDelete?: () => void;
}

/**
 * Baseline `participants.helpers.js` name fallback chain (`entity_meta.name`
 * then `meta.user_name`) — exported so `index.tsx` can sort the list by the
 * same display name this component renders (baseline: `UserMenu.jsx:15-19`'s
 * `options.sort((a, b) => a.meta?.user_name...localeCompare(...))`).
 */
export function participantName(participant: Record<string, unknown>): string {
  return (
    (participant.entity_meta?.name as string | undefined) ||
    (participant.meta?.user_name as string | undefined) ||
    t('chat-participants.common.user', 'User')
  );
}

/**
 * UserMenu component — renders a single user option in the dropdown.
 */
const UserMenu = memo((props: UserMenuProps): React.ReactElement => {
  const { participant, onSelect, onClose, disabled = false, onDelete } = props;

  const name = participantName(participant);

  const handleSelect = () => {
    if (disabled) return;
    onSelect();
    onClose();
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    onDelete?.();
  };

  return (
    <Box
      onClick={handleSelect}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1,
        borderRadius: 'var(--el-shape-radiusSm, 4px)',
        cursor: disabled ? 'default' : 'pointer',
        '&:hover': disabled ? undefined : { backgroundColor: 'action.hover' },
        '& .participant-delete-action': { visibility: 'hidden' },
        ...(onDelete ? { '&:hover .participant-delete-action': { visibility: 'visible' } } : {}),
      }}
    >
      <PersonIcon fontSize="small" sx={{ color: disabled ? 'text.disabled' : 'text.secondary' }} />
      <Typography variant="bodySmall" color={disabled ? 'text.disabled' : 'text.primary'} sx={{ flex: 1 }}>
        {name}
      </Typography>
      {onDelete && (
        <IconButton
          className="participant-delete-action"
          size="small"
          onClick={handleDelete}
          aria-label={t('chat-participants.dropdown.removeUser', 'Remove user')}
        >
          <DeleteOutlineRounded fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
});

UserMenu.displayName = 'UserMenu';

export default UserMenu;
