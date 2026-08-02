import { memo, useRef, useState } from 'react';

import { Box, IconButton, Paper, Popper, useTheme } from '@mui/material';

/**
 * Phase-2 Chat button primitive: ChatInternalToolsConfigButton
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
const ChatInternalToolsConfigButton = memo((_props: { disabled?: boolean }) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const theme = useTheme();

  void setIsOpen;
  void _props;

  return (
    <>
      <IconButton
        ref={ref}
        color="secondary"
        aria-label="internal tools"
        onClick={() => setAnchorEl(prev => (prev ? null : ref.current))}
        disabled={false}
        sx={{ marginLeft: 0 }}
      >
        <Box component="span" sx={{ fontSize: '1rem' }}>
          ⚙
        </Box>
      </IconButton>
      <Popper
        open={isOpen}
        anchorEl={anchorEl}
        placement="top-end"
        style={{ zIndex: 9998 }}
      >
        <Paper
          elevation={8}
          sx={{
            minWidth: 200,
            borderRadius: '.5rem',
            padding: '.5rem 0',
            border: `.0625rem solid ${theme.palette.border.lines}`,
            boxShadow: theme.palette.boxShadow.default,
            backgroundColor: theme.palette.background.secondary,
          }}
        >
          <Box sx={{ padding: '0.5rem 1rem', color: 'text.disabled' }}>
            No tools available
          </Box>
        </Paper>
      </Popper>
    </>
  );
});

ChatInternalToolsConfigButton.displayName = 'ChatInternalToolsConfigButton';

export default ChatInternalToolsConfigButton;
