// @ts-nocheck
/**
 * CollapsedParticipantsList — list of participants in collapsed view.
 *
 * Ported from `[fsd]/features/chat/participants/ui/CollapsedParticipants/CollapsedPerticapantsList.jsx`.
 */
import { memo } from 'react';

import { ListItem, ListItemButton, ListItemText } from '@mui/material';

import { t } from '@/shared/ui/lib/t';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CollapsedParticipantsListProps {
  participants: Record<string, unknown>[];
  onItemClick?: (participant: Record<string, unknown>) => void;
}

/**
 * CollapsedParticipantsList component — list of participants for collapsed overflow dropdown.
 */
const CollapsedParticipantsList = memo((props: CollapsedParticipantsListProps): React.ReactElement => {
  const { participants, onItemClick } = props;

  return (
    <>
      {participants.map((p) => {
        const name = p.entity_meta?.name || p.meta?.user_name || t('chat.participants.unknown', 'Unknown');
        return (
          <ListItem key={p.id} disablePadding>
            <ListItemButton onClick={() => onItemClick?.(p)}>
              <ListItemText primary={name} primaryTypographyProps={{ variant: 'bodySmall' }} />
            </ListItemButton>
          </ListItem>
        );
      })}
    </>
  );
});

CollapsedParticipantsList.displayName = 'CollapsedParticipantsList';

export default CollapsedParticipantsList;
