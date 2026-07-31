// @ts-nocheck
/**
 * DeleteParticipantButton — delete confirmation button for a participant.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ParticipantActions/DeleteParticipantButton.jsx`.
 */
import { memo } from 'react';

import { IconButton, Tooltip } from '@mui/material';

import DeleteIcon from '@mui/icons-material/Delete';

import { t } from '@/shared/ui/lib/t';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DeleteParticipantButtonProps {
  participant: Record<string, unknown>;
  onDelete?: (participant: Record<string, unknown>) => void;
  disabled?: boolean;
}

/**
 * DeleteParticipantButton component.
 */
const DeleteParticipantButton = memo((props: DeleteParticipantButtonProps): React.ReactElement | null => {
  const { participant, onDelete, disabled } = props;

  if (!onDelete) return null;

  const displayName = participant.entity_meta?.name || participant.entity_meta?.model_name || t('chat-participants.common.participant', 'Participant');

  return (
    <Tooltip title={`${t('chat-participants.tooltip.delete', 'Delete')} ${displayName}`}>
      <span>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(participant);
          }}
          disabled={disabled}
          sx={{ color: 'text.secondary' }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
});

DeleteParticipantButton.displayName = 'DeleteParticipantButton';

export default DeleteParticipantButton;
