import { memo } from 'react';

import { Box, IconButton, Tooltip, useTheme } from '@mui/material';

/**
 * Phase-2 Chat button primitive: ClearChatButton
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
const ClearChatButton = memo(({ disabled = false, onClear }: { disabled?: boolean; onClear?: () => void }) => {
  const theme = useTheme();

  return (
    <Tooltip placement="top" title="Clear the chat">
      <Box component="span">
        <IconButton
          color="secondary"
          aria-label="clear the chat"
          disabled={disabled}
          onClick={onClear}
          sx={{ marginLeft: 0 }}
        >
          <Box component="span" sx={{ fontSize: 16, color: theme.palette.icon.fill.secondary }}>
            ✕
          </Box>
        </IconButton>
      </Box>
    </Tooltip>
  );
});

ClearChatButton.displayName = 'ClearChatButton';

export default ClearChatButton;
