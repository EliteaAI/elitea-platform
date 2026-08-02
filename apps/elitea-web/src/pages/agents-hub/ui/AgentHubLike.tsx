/**
 * Agent Hub Like — like/unlike button for agent cards.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent-hub/ui/AgentHubLike.jsx`.
 *
 * Deviations:
 *  - Uses `useCardLike` from entities/application/model instead of the old
 *    Redux-based `Like` component and AgentHubContext.
 *  - Uses heart icons from shared/ui/icons.
 *  - No tour IDs.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { HeartIcon } from '@/shared/ui/icons/heart-icon';
import { HeartActiveIcon } from '@/shared/ui/icons/heart-active-icon';
import { useCardLike } from '@/entities/application/model/useCardLike';

import type { ApplicationData } from '../types';

export interface AgentHubLikeProps {
  data: ApplicationData;
}

const AgentHubLike = memo(({ data }: AgentHubLikeProps) => {
  const { isLiked, likeCount, toggleLike } = useCardLike({
    applicationId: data.id,
    initialLiked: data.is_liked ?? false,
    initialCount: data.likes ?? 0,
    onLikeSuccess: (_id, _liked, _count) => {
      // Optimistic updates handled by useCardLike internally.
      // In a full implementation, this would call the server API.
    },
  });

  return (
    <Box
      onClick={() => { void toggleLike(); }}
      sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5 }}
    >
      {isLiked ? <HeartActiveIcon /> : <HeartIcon />}
      <Typography variant="bodySmall">{likeCount}</Typography>
    </Box>
  );
});

AgentHubLike.displayName = 'AgentHubLike';

export default AgentHubLike;
