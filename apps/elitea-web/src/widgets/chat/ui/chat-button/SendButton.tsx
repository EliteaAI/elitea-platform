import { memo, useCallback } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

/**
 * Chat button primitive: SendButton
 *
 * Displays either:
 *  - a send arrow (when there is text and not in speaking mode)
 *  - a microphone icon (clickable to enter speaking mode)
 *  - a speaking-mode strip (microphone + stop button)
 *
 * Prop contract (injected by the composition root through `slots.sendControl`):
 *   - `isSpeakingMode`      — show the speaking-mode strip
 *   - `question`            — current input text (controls disabled state)
 *   - `disabledSend`        — disable the send action
 *   - `onEnterSpeakingMode` — toggle into speaking mode (mic click when idle)
 *   - `onExitSpeakingMode`  — toggle out of speaking mode (stop button)
 *   - `onSend`              — fire the send action
 *   - `tooltipOfSendButton` — optional tooltip override for the send action
 */
export interface SendButtonProps {
  isSpeakingMode?: boolean;
  question?: string;
  disabledSend?: boolean;
  onEnterSpeakingMode?: () => void;
  onExitSpeakingMode?: () => void;
  onSend?: () => void;
  tooltipOfSendButton?: string;
}

export const SendButton = memo(
  ({
    isSpeakingMode = false,
    question = '',
    disabledSend = false,
    onEnterSpeakingMode,
    onExitSpeakingMode,
    onSend,
    tooltipOfSendButton = 'Send',
  }: SendButtonProps) => {
    const isEmpty = !question;
    const isDisabled = disabledSend || isEmpty;

    const handleSend = useCallback(() => {
      if (!isDisabled) {
        onSend?.();
      }
    }, [isDisabled, onSend]);

    const handleEnterSpeaking = useCallback(() => {
      onEnterSpeakingMode?.();
    }, [onEnterSpeakingMode]);

    const handleExitSpeaking = useCallback(() => {
      onExitSpeakingMode?.();
    }, [onExitSpeakingMode]);

    // Speaking mode strip
    if (isSpeakingMode) {
      return (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            padding: '0.5rem 1rem',
            borderRadius: '0.875rem',
            border: '1px solid',
            borderColor: 'border.chatContinue',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              color: 'primary.main',
            }}
          >
            <SendIcon fontSize="small" />
            <Box
              component="span"
              sx={{ fontSize: '0.875rem', color: 'text.secondary' }}
            >
              Speaking...
            </Box>
          </Box>
          <Tooltip title="Stop speaking">
            <IconButton
              size="small"
              onClick={handleExitSpeaking}
              sx={{ color: 'text.secondary' }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      );
    }

    // Idle state: show mic icon to enter speaking mode, or send arrow if text
    if (isEmpty) {
      return (
        <Tooltip title="Start speaking" placement="top">
          <Box
            component="span"
            sx={{
              cursor: 'pointer',
              opacity: isDisabled ? 0.5 : 1,
              color: 'text.secondary',
            }}
            onClick={!isDisabled ? handleEnterSpeaking : undefined}
          >
            <SendIcon fontSize="small" />
          </Box>
        </Tooltip>
      );
    }

    // Active state: send button
    return (
      <Tooltip title={tooltipOfSendButton} placement="top">
        <Box
          data-testid="chat-send-button"
          component="span"
          sx={{
            cursor: isDisabled ? 'default' : 'pointer',
            opacity: isDisabled ? 0.5 : 1,
            color: isDisabled ? 'text.disabled' : 'primary.main',
          }}
          onClick={isDisabled ? undefined : handleSend}
        >
          <SendIcon fontSize="small" />
        </Box>
      </Tooltip>
    );
  },
);

SendButton.displayName = 'SendButton';

export default SendButton;
