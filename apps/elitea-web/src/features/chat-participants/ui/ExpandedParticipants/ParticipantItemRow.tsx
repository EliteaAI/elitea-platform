// @ts-nocheck
import { memo } from 'react';

import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { useParticipantEntityIcon } from '../../lib/hooks/useParticipantEntityIcon';
import { useParticipantName } from '../../lib/hooks/useParticipantName';

import type { TransformedParticipant } from '../../model/types';

// ---------------------------------------------------------------------------
// ParticipantItemRow — internal helper for the "users" row
// ---------------------------------------------------------------------------

/** Minimal row item for user participants in the expanded header. */
export interface ParticipantItemRowProps {
  readonly participant: TransformedParticipant;
  readonly isActive: boolean;
  readonly onClickItem: (participant: TransformedParticipant) => void;
}

const ParticipantItemRow = memo(
  ({ participant, isActive, onClickItem }: ParticipantItemRowProps) => {
    const theme = useTheme();
    const name = useParticipantName(participant);
    const iconResult = useParticipantEntityIcon(participant);

    return (
      <Box
        component="button"
        type="button"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          background: 'transparent',
          border: 'none',
          cursor: isActive ? 'default' : 'pointer',
          padding: '0.25rem 0.5rem',
          borderRadius: 'var(--el-shape-radiusSm, 4px)',
          opacity: isActive ? 1 : 0.85,
          '&:hover': {
            opacity: 1,
            backgroundColor: 'action.hover',
          },
        }}
        onClick={() => onClickItem(participant)}
        aria-label={`Select participant: ${name}`}
        data-testid={`participant-item-${participant.entity_meta?.id ?? ''}`}
      >
        {iconResult.url && (
          <Box
            component="img"
            src={iconResult.url}
            alt={name}
            sx={{ width: 20, height: 20, borderRadius: 'var(--el-shape-radiusSm, 4px)' }}
          />
        )}
        {!iconResult.url && (
          <Box
            sx={{
              width: 20,
              height: 20,
              borderRadius: 'var(--el-shape-radiusSm, 4px)',
              backgroundColor: 'action.selected',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: theme.typography.labelTiny.fontSize,
              fontWeight: 600,
            }}
          >
            {(name?.[0] ?? '?').toUpperCase()}
          </Box>
        )}
        <Typography
          variant="bodySmall"
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '12rem',
          }}
        >
          {name}
        </Typography>
      </Box>
    );
  },
);

ParticipantItemRow.displayName = 'ParticipantItemRow';

export default ParticipantItemRow;
