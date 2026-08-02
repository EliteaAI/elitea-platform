import { memo } from 'react';

import { Box, IconButton, useTheme } from '@mui/material';

/**
 * Phase-2 Chat button primitive: VoiceButton
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
const VoiceButton = memo((_props: { disabled?: boolean; onRecordingChange?: (v: boolean) => void }) => {
  const theme = useTheme();
  return (
    <Box
      component="span"
      sx={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
    >
      <IconButton
        color="secondary"
        aria-label="voice input"
        disabled={false}
        sx={{ marginLeft: 0 }}
      >
        <Box component="span" sx={{ fontSize: '1rem', color: theme.palette.text.secondary }}>
          🎙
        </Box>
      </IconButton>
    </Box>
  );
});

VoiceButton.displayName = 'VoiceButton';

export default VoiceButton;
