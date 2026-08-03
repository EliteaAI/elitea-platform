import { useCallback } from 'react';

import { Box, ClickAwayListener, Skeleton, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

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

const NO_MATCHING_RESULTS_LABEL = 'No matching results';

/** Pulled out of the component body to keep NewParticipantList's own cyclomatic complexity in budget. */
function shouldShowEmptyState(isLoading: boolean, isFetching: boolean, participants: unknown[]): boolean {
  return !isLoading && !participants?.length && !isFetching;
}

const NewParticipantList = ({
  onSelectParticipant,
  isLoading = false,
  isFetching = false,
  participants = [],
  existingParticipantUids = [],
  onClose = () => {},
  title = 'Frequently used',
  activeIndex = -1,
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
          borderRadius: theme.vars.shape.radiusLg,
          boxSizing: 'border-box',
          padding: theme.spacing(1.5),
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing(1.5),
          background: theme.vars.palette.background.secondary,
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
            padding: theme.spacing(0, 1),
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
            gap: theme.spacing(1.5),
            width: '100%',
          }}
        >
          {shouldShowEmptyState(isLoading, isFetching, participants) && (
            <Typography variant="bodyMedium" color="text.secondary" sx={{ padding: theme.spacing(0, 1), width: '100%' }}>
              {NO_MATCHING_RESULTS_LABEL}
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
                  sx={{ borderRadius: theme.vars.shape.radiusMd, border: '1px solid', borderColor: 'border.lines' }}
                />
              ))}
          {!isLoading &&
            (participants as (Record<string, unknown> & { participantId?: string })[]).map((rawItem, idx) => {
              const item = rawItem as { id: string; name: string; description?: string; participantType?: string; project_id?: string };
              const participantType = item.participantType ?? '';
              const projectId = item.project_id ?? '';
              const participantId = `${participantType}_${item.id}_${projectId}`;
              return (
                <NewParticipantCard
                  key={`${participantType}_${item.id}`}
                  participant={item}
                  onClick={onClickParticipant}
                  alreadyExists={existingParticipantUids.includes(participantId)}
                  isActive={idx === activeIndex}
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
