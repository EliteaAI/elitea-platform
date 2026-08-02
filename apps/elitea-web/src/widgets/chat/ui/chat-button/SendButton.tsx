import { memo } from 'react';

import CloseRounded from '@mui/icons-material/CloseRounded';
import { Box } from '@mui/material';

/**
 * Phase-2 Chat button primitive: SendButton
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
const SendButton = memo(
  ({
    isSpeakingMode = false,
    question = '',
    disabledSend = false,
    onEnterSpeakingMode,
    onExitSpeakingMode,
    onSend,
  }: {
    isSpeakingMode?: boolean;
    question?: string;
    disabledSend?: boolean;
    onEnterSpeakingMode?: () => void;
    onExitSpeakingMode?: () => void;
    onSend?: () => void;
  }) => {
    if (isSpeakingMode) {
      return (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            borderRadius: '0.875rem',
            border: '1px solid',
            borderColor: 'border.chatContinue',
          }}
        >
          <Box component="span" sx={{ fontSize: '1rem' }}>
            🎙
          </Box>
          <Box component="span" sx={{ fontSize: '1rem', cursor: 'pointer' }} onClick={onExitSpeakingMode}>
            <CloseRounded />
          </Box>
        </Box>
      );
    }

    if (!question) {
      return (
        <Box
          component="span"
          sx={{
            fontSize: '1rem',
            cursor: 'pointer',
            opacity: disabledSend ? 0.5 : 1,
          }}
          onClick={onEnterSpeakingMode}
        >
          🎙
        </Box>
      );
    }

    return (
      <Box
        data-testid="chat-send-button"
        component="span"
        sx={{
          fontSize: '1rem',
          cursor: disabledSend || !question ? 'default' : 'pointer',
          opacity: disabledSend || !question ? 0.5 : 1,
          color: 'primary.main',
        }}
        onClick={disabledSend || !question ? undefined : onSend}
      >
        →
      </Box>
    );
  },
);

SendButton.displayName = 'SendButton';

export default SendButton;
