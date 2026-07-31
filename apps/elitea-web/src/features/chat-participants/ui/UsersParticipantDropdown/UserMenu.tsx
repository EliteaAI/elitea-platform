// @ts-nocheck
/**
 * UserMenu — single user item in the participant dropdown.
 *
 * Ported from `[fsd]/features/chat/participants/ui/UsersParticipantDropdown/UserMenu.jsx`.
 */
import { memo } from 'react';

import { ListItemButton, ListItemIcon, ListItemText } from '@mui/material';

import PersonIcon from '@mui/icons-material/Person';

import { t } from '@/shared/ui/lib/t';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UserMenuProps {
  participant: Record<string, unknown>;
  onSelect: () => void;
  onClose: () => void;
}

/**
 * UserMenu component — renders a single user option in the dropdown.
 */
const UserMenu = memo((props: UserMenuProps): React.ReactElement => {
  const { participant, onSelect, onClose } = props;

  const name = participant.entity_meta?.name || participant.meta?.user_name || t('chat-participants.common.user', 'User');

  return (
    <ListItemButton
      onClick={() => {
        onSelect();
        onClose();
      }}
    >
      <ListItemIcon>
        <PersonIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText primary={name} primaryTypographyProps={{ variant: 'bodySmall' }} />
    </ListItemButton>
  );
});

UserMenu.displayName = 'UserMenu';

export default UserMenu;
