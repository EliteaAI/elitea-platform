// @ts-nocheck
/**
 * CollapsedParticipantsList — list of participants rendered inside a
 * collapsed-section popper.
 *
 * Structurally, this file plays the role of the old app's
 * `CollapsedParticipantsDropdown.jsx` (the *popper content* — the component
 * that actually renders participant rows with working actions), NOT the
 * similarly-named `CollapsedPerticapantsList.jsx` (that file's role is
 * played by this cluster's sibling `CollapsedParticipantsDropdown.tsx`,
 * which owns the per-entity-type trigger + `Popper` — see that file's own
 * header comment for the full old-app-file → new-app-file mapping).
 *
 * FIXED regression: this file previously only supported `onItemClick`
 * (selection) — there was no `onDelete`/`onEdit` prop or rendering path at
 * all, so a user could not edit or remove a participant from the collapsed
 * view. Old-app baseline (`CollapsedParticipantsDropdown.jsx:156-170`)
 * rendered a full `ParticipantItem` per row with `onDelete`/
 * `onUpdateParticipant`/`onEdit` wired through `ParticipantActions`. This
 * port renders `ParticipantActions` (`../ParticipantActions/
 * ParticipantActions.tsx`, this cluster's own sibling file) directly per
 * row instead of the full `ParticipantItem` card — `ExpandedParticipants/
 * ParticipantItem.tsx` is owned by a different unit and outside this
 * cluster's file scope — so the same two actions (edit/delete) are
 * reachable here too, without depending on that file's own wiring.
 */
import { memo } from 'react';

import { ListItem, ListItemButton, ListItemText } from '@mui/material';

import { t } from '@/shared/i18n';

import ParticipantActions from '../ParticipantActions/ParticipantActions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CollapsedParticipantsListProps {
  participants: Record<string, unknown>[];
  activeParticipantId?: string;
  disabledEdit?: boolean;
  onItemClick?: (participant: Record<string, unknown>) => void;
  onDelete?: (participant: Record<string, unknown>) => void;
  onEdit?: (participant: Record<string, unknown>) => void;
}

/**
 * CollapsedParticipantsList component — list of participants for a
 * collapsed-section overflow popper, each row with working edit/delete
 * actions.
 */
const CollapsedParticipantsList = memo((props: CollapsedParticipantsListProps): React.ReactElement => {
  const { participants, activeParticipantId, disabledEdit, onItemClick, onDelete, onEdit } = props;

  return (
    <>
      {participants.map((p) => {
        const entityMeta = p.entity_meta as Record<string, unknown> | undefined;
        const meta = p.meta as Record<string, unknown> | undefined;
        const name =
          (entityMeta?.name as string | undefined) ??
          (meta?.user_name as string | undefined) ??
          t('chat-participants.common.unknown', 'Unknown');
        const isActive = activeParticipantId !== undefined && p.id === activeParticipantId;
        const hasActions = Boolean(onEdit) || Boolean(onDelete);
        const idValue = (p.id as string | number | undefined) ?? name;

        return (
          <ListItem
            key={String(idValue)}
            disablePadding
            secondaryAction={
              hasActions ? (
                <ParticipantActions
                  participant={p}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  disabledEdit={disabledEdit}
                  showButtons
                  showEditButton={Boolean(onEdit)}
                />
              ) : undefined
            }
          >
            <ListItemButton onClick={() => onItemClick?.(p)} selected={isActive}>
              <ListItemText primary={name} primaryTypographyProps={{ variant: 'bodySmall' }} sx={{ pr: hasActions ? 9 : 0 }} />
            </ListItemButton>
          </ListItem>
        );
      })}
    </>
  );
});

CollapsedParticipantsList.displayName = 'CollapsedParticipantsList';

export default CollapsedParticipantsList;
