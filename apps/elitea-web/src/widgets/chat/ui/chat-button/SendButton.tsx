import { memo, useCallback } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { VoicewaveIcon } from '@/shared/ui/icons/voicewave-icon';

/**
 * Chat button primitive: SendButton
 *
 * Displays either:
 *  - a send arrow (when there is text, or voice features are off)
 *  - a voice-wave icon (clickable to enter speaking mode, when the input is empty)
 *  - a speaking-mode strip (voice-wave + stop button)
 *
 * `micDisabled` (= `disabledSend` alone) gates the mic control independently
 * of `isDisabled` (= `disabledSend || isEmpty`, used by the send control) —
 * the mic branch only renders when `isEmpty` is already true, so reusing
 * `isDisabled` there made the mic permanently non-interactive regardless of
 * `disabledSend` (baseline `SendButton.jsx:57` gates it on `disabledSend`
 * alone).
 *
 * `VOICE_FEATURES_ENABLED`/`VOICE_FEATURES_TEMPORARILY_DISABLED` are
 * hardcoded to baseline's own env-flag defaults, same disclosed
 * `shared/config` `ConfigSchema` gap `features/chat-input/ui/
 * VoiceControlButton.tsx` already established (no schema field yet).
 *
 * Prop contract (injected by the composition root through `slots.sendControl`):
 *   - `isSpeakingMode`      — show the speaking-mode strip
 *   - `question`            — current input text (controls disabled state)
 *   - `disabledSend`        — disable the send action / mic control
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

const VOICE_FEATURES_ENABLED = true;
const VOICE_FEATURES_TEMPORARILY_DISABLED = false;

const voicewaveIconStyle = { width: '1rem', height: '1rem' };

/** Split out purely to keep the component under the §3.5 cyclomatic-complexity-12 budget — every branch below is driven by a single `disabled` flag, repeated per render state. */
function disabledCursorOpacitySx(disabled: boolean): { cursor: 'default' | 'pointer'; opacity: number } {
  return { cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 };
}

function micTooltipTitle(): string {
  return VOICE_FEATURES_TEMPORARILY_DISABLED
    ? t('widgets.chat.sendButton.micDisabledTooltip', 'Temporarily disabled by admin')
    : t('widgets.chat.sendButton.startSpeakingTooltip', 'Start speaking');
}

export const SendButton = memo(
  ({
    isSpeakingMode = false,
    question = '',
    disabledSend = false,
    onEnterSpeakingMode,
    onExitSpeakingMode,
    onSend,
    tooltipOfSendButton = t('widgets.chat.sendButton.defaultTooltip', 'Send'),
  }: SendButtonProps) => {
    const isEmpty = !question;
    const isDisabled = disabledSend || isEmpty;
    const micDisabled = disabledSend;

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
          sx={(theme: Theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            padding: '0.5rem 1rem',
            borderRadius: theme.vars.shape.radiusLg,
            border: '1px solid',
            borderColor: 'border.chatContinue',
          })}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              color: 'primary.main',
            }}
          >
            <VoicewaveIcon style={voicewaveIconStyle} />
            <Typography component="span" variant="bodyMedium" color="text.secondary">
              {t('widgets.chat.sendButton.speakingLabel', 'Speaking...')}
            </Typography>
          </Box>
          <Tooltip title={t('widgets.chat.sendButton.stopSpeakingTitle', 'Stop speaking')}>
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

    // Idle, empty input: show the voice-wave icon to enter speaking mode.
    if (isEmpty && VOICE_FEATURES_ENABLED) {
      return (
        <Tooltip title={micTooltipTitle()} placement="top">
          <Box
            component="span"
            sx={{ ...disabledCursorOpacitySx(micDisabled), color: 'text.secondary' }}
            onClick={!micDisabled ? handleEnterSpeaking : undefined}
          >
            <VoicewaveIcon style={voicewaveIconStyle} />
          </Box>
        </Tooltip>
      );
    }

    // Active state: send button (has text, or voice features are off)
    return (
      <Tooltip title={tooltipOfSendButton} placement="top">
        <Box
          data-testid="chat-send-button"
          component="span"
          sx={{ ...disabledCursorOpacitySx(isDisabled), color: isDisabled ? 'text.disabled' : 'primary.main' }}
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
