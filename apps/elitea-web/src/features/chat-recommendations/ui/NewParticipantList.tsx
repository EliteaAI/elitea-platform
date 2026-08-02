import { useCallback } from 'react';

import { Box, ClickAwayListener, Skeleton, Typography, useTheme } from '@mui/material';

import NewParticipantCard from './NewParticipantCard';

/**
 * Phase-4 NewParticipantList
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type NewParticipantListProps = {
  onSelectParticipant: (participant: unknown) => void;
  isLoading?: boolean;
  isFetching?: boolean;
  participants?: unknown[];
  existingParticipantUids?: string[];
  onClose?: () => void;
  title?: string;
  activeIndex?: number;
};

const NewParticipantList = ({
  onSelectParticipant,
  isLoading = false,
  isFetching = false,
  participants = [],
  existingParticipantUids = [],
  onClose = () => {},
  title = 'Frequently used',
}: NewParticipantListProps) => {
  const theme = useTheme();

  const onClickParticipant = useCallback(
    (participant: unknown) => {
      onSelectParticipant(participant);
    },
    [onSelectParticipant],
  );

  return (
    <ClickAwayListener onClickAway={onClose}>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'border.lines',
          width: '100%',
          maxHeight: '247px',
          borderRadius: '16px',
          boxSizing: 'border-box',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          background: theme.palette.background.secondary,
          height: 'auto',
          overflowY: 'auto',
        }}
      >
        <Box
          sx={{
            height: '16px',
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            padding: '0 8px',
          }}
        >
          <Typography variant="subtitle" color="text.primary">
            {title}
          </Typography>
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: '12px',
            width: '100%',
          }}
        >
          {!isLoading && !participants?.length && !isFetching && (
            <Typography variant="bodyMedium" color="text.secondary" sx={{ padding: '0 8px', width: '100%' }}>
              No matching results
            </Typography>
          )}
          {isLoading &&
            Array(6)
              .fill(null)
              .map((_, i) => (
                <Skeleton
                  key={`isLoading-${i}`}
                  variant="rectangular"
                  width={250}
                  height={56}
                  sx={{ borderRadius: '8px', border: '1px solid', borderColor: 'border.lines' }}
                />
              ))}
          {!isLoading &&
            (participants as (Record<string, unknown> & { participantId?: string })[]).map((item, idx) => {
              const participantId = `${item.participantType}_${item.id}_${item.project_id}`;
              return (
                <NewParticipantCard
                  key={`${item.participantType}_${item.id}`}
                  participant={item as { id: string; name: string; description?: string; participantType?: string; project_id?: string }}
                  onClick={onClickParticipant}
                  alreadyExists={existingParticipantUids.includes(participantId)}
                  isActive={idx === 0}
                />
              );
            })}
        </Box>
      </Box>
    </ClickAwayListener>
  );
};

NewParticipantList.displayName = 'NewParticipantList';

export default NewParticipantList;
