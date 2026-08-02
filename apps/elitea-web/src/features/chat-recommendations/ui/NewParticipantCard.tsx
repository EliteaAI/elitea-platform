import { memo, useCallback } from 'react';

import { Box, Typography, useTheme } from '@mui/material';

/**
 * Phase-4 NewParticipantCard
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type NewParticipantCardProps = {
  participant: {
    id: string;
    name: string;
    description?: string;
    participantType?: string;
    project_id?: string;
  };
  onClick: (participant: NewParticipantCardProps['participant']) => void;
  alreadyExists?: boolean;
  isActive?: boolean;
};

const NewParticipantCard = memo(({ participant, onClick, alreadyExists = false, isActive = false }: NewParticipantCardProps) => {
  const theme = useTheme();

  void theme;

  const onClickHandler = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick(participant);
    },
    [onClick, participant],
  );

  return (
    <Box
      onClick={onClickHandler}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        borderRadius: '0.5rem',
        padding: '0.5rem 0.75rem',
        height: '3.5rem',
        cursor: alreadyExists ? 'default' : 'pointer',
        background: isActive ? 'background.userInputBackgroundActive' : 'background.userInputBackground',
        border: alreadyExists ? '1px solid' : 'none',
        borderColor: 'border.userMessageEditor',
        '&:hover': {
          background: 'background.userInputBackgroundActive',
        },
      }}
    >
      <Box
        sx={{
          width: '1.5rem',
          height: '1.5rem',
          borderRadius: '50%',
          background: 'primary.main',
        }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="headingSmall"
          color="text.secondary"
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {participant.name}
        </Typography>
        <Typography variant="bodySmall" color="text.default" sx={{ textTransform: 'capitalize' }}>
          {participant.participantType || 'agent'}
        </Typography>
      </Box>
    </Box>
  );
});

NewParticipantCard.displayName = 'NewParticipantCard';

export default NewParticipantCard;
