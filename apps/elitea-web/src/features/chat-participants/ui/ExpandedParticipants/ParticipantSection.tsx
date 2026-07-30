// @ts-nocheck
/**
 * ParticipantSection — collapsible section with title and participant list.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ExpandedParticipants/ParticipantSection.jsx`.
 */
import { memo, useCallback, useState } from 'react';

import { Box, Collapse, IconButton, Typography } from '@mui/material';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import type { ExpandedParticipantsListProps } from './ExpandedParticipantsList';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ParticipantSectionProps {
  title: string;
  participants: Record<string, unknown>[];
  collapsed?: boolean;
  disabledEdit?: boolean;
  onItemClick?: (participant: Record<string, unknown>) => void;
  onDelete?: (participant: Record<string, unknown>) => void;
  onEdit?: (participant: Record<string, unknown>) => void;
  editingToolkit?: Record<string, unknown>;
  mcpLoginSlot?: React.ReactNode;
  mcpLogoutSlot?: React.ReactNode;
  sharepointLoginSlot?: React.ReactNode;
}

/**
 * ParticipantSection component — section with collapsible header and participant list.
 */
const ParticipantSection = memo((props: ParticipantSectionProps): React.ReactElement | null => {
  const {
    title,
    participants,
    collapsed,
    disabledEdit,
    onItemClick,
    onDelete,
    onEdit,
    editingToolkit,
    mcpLoginSlot,
    mcpLogoutSlot,
    sharepointLoginSlot,
  } = props;

  const [isExpanded, setIsExpanded] = useState(!collapsed);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (!participants?.length) return null;

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1,
          py: 0.5,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={toggleExpand}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title} ({participants.length})
        </Typography>
        <IconButton size="small" onClick={toggleExpand}>
          {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={isExpanded}>
        <Box sx={{ px: 1 }}>
          {/* ExpandedParticipantsList would be imported from './ExpandedParticipantsList' */}
          {/* Delegated to parent for cleaner barrel exports */}
        </Box>
      </Collapse>
    </Box>
  );
});

ParticipantSection.displayName = 'ParticipantSection';

export default ParticipantSection;
