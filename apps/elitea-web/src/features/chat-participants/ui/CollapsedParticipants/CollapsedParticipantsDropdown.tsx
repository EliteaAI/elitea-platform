// @ts-nocheck
/**
 * CollapsedParticipantsDropdown — collapsed overflow dropdown for participants.
 *
 * Ported from `[fsd]/features/chat/participants/ui/CollapsedParticipants/CollapsedParticipantsDropdown.jsx`.
 */
import { memo, useState } from 'react';

import { Box, ClickAwayListener, Paper, Popper, Typography } from '@mui/material';

import CollapsedParticipantsList from './CollapsedParticipantsList';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CollapsedParticipantsDropdownProps {
  participants: Record<string, unknown>[];
  maxVisible?: number;
  onItemClick?: (participant: Record<string, unknown>) => void;
  showPopover?: boolean;
  onTogglePopover?: () => void;
  anchorEl?: HTMLElement | null;
}

/**
 * CollapsedParticipantsDropdown component — shows icon row with overflow count.
 * Clicking the overflow count opens a Popper with the full list.
 */
const CollapsedParticipantsDropdown = memo((props: CollapsedParticipantsDropdownProps): React.ReactElement | null => {
  const { participants, maxVisible = 5, onItemClick, anchorEl } = props;
  const [showPopover, setShowPopover] = useState(false);

  if (!participants?.length) return null;

  const visible = participants.slice(0, maxVisible);
  const overflow = participants.length - maxVisible;

  const togglePopover = () => setShowPopover((prev) => !prev);

  return (
    <ClickAwayListener onClickAway={() => setShowPopover(false)}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {visible.map((p) => {
          const name = p.entity_meta?.name || p.meta?.user_name || '?';
          return (
            <Box
              key={p.id}
              onClick={() => onItemClick?.(p)}
              sx={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: 'action.selected',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '0.65rem',
                fontWeight: 600,
                color: 'text.primary',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              {name[0]?.toUpperCase() ?? '?'}
            </Box>
          );
        })}
        {overflow > 0 && (
          <Box
            onClick={togglePopover}
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              backgroundColor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '0.65rem',
              fontWeight: 600,
              color: 'primary.contrastText',
            }}
          >
            +{overflow}
          </Box>
        )}
        <Popper
          open={showPopover}
          anchorEl={anchorEl}
          placement="bottom-start"
          modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}
        >
          <Paper elevation={3} sx={{ maxHeight: 300, overflow: 'auto', minWidth: 200 }}>
            <CollapsedParticipantsList
              participants={participants}
              onItemClick={(p) => {
                onItemClick?.(p);
                setShowPopover(false);
              }}
            />
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
});

CollapsedParticipantsDropdown.displayName = 'CollapsedParticipantsDropdown';

export default CollapsedParticipantsDropdown;
