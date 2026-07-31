// @ts-nocheck
/**
 * EditParticipantButton — edit gate button for a participant.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ParticipantActions/EditParticipantButton.jsx`.
 *
 * Cross-cutting gap: the old app imported `usePublicProjectAccessCheck` from
 * `features/project/lib/hooks`. `features/project` does NOT exist in the new-app
 * (not owned by any Wave-2 unit). Conservative treatment: treat
 * `hasPublicProjectAccess` as always-false — public projects cannot be edited
 * by this component. This is a disclosed gap documented here and in the unit's
 * landing report for eventual resolution when a real permission source exists.
 */
import { memo } from 'react';

import { IconButton, Tooltip } from '@mui/material';

import EditIcon from '@mui/icons-material/Edit';

import { t } from '@/shared/ui/lib/t';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EditParticipantButtonProps {
  participant: Record<string, unknown>;
  onEdit?: (participant: Record<string, unknown>) => void;
  disabled?: boolean;
}

/**
 * EditParticipantButton component.
 *
 * Disclosed gap: `hasPublicProjectAccess` gate from old app is replaced with
 * `false` (public projects cannot be edited). See file header for details.
 */
const EditParticipantButton = memo((props: EditParticipantButtonProps): React.ReactElement | null => {
  const { participant, onEdit, disabled } = props;

  if (!onEdit) return null;

  // Disclosed gap: old app checked `hasPublicProjectAccess` from
  // `features/project/lib/hooks`. No equivalent exists in new-app.
  // Treat public project access as always-false.
  const entityMeta = participant.entity_meta as Record<string, unknown> | undefined;
  const isPublic = entityMeta?.project_id === 'public'; // Replace with real constant when available
  const hasPublicProjectAccess = false; // Disclosed gap — conservative default

  const canEdit = (!isPublic && true) || (isPublic && hasPublicProjectAccess);

  if (!canEdit || disabled) return null;

  const displayName = participant.entity_meta?.name || t('chat-participants.common.participant', 'Participant');

  return (
    <Tooltip title={`${t('chat-participants.tooltip.edit', 'Edit')} ${displayName}`}>
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onEdit(participant);
        }}
        sx={{ color: 'text.secondary' }}
      >
        <EditIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
});

EditParticipantButton.displayName = 'EditParticipantButton';

export default EditParticipantButton;
