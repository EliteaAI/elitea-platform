/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/voice-mini-player/
 * VoiceMiniPlayer.jsx`. A TTS-side (playback) presentational wrapper around
 * `VoiceControlButton`, forwarding straight through to it — that component
 * renders the real `VoiceConfigDialog` directly (no injected slot; see its
 * own module doc), so `VoiceMiniPlayerProps` is just `VoiceControlButtonProps`
 * with zero adapter needed here.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';

import { MegaphoneIcon } from '@/shared/ui/icons/megaphone-icon';

import { VoiceControlButton } from './VoiceControlButton';
import type { VoiceControlButtonProps } from './VoiceControlButton';

const VOICE_FEATURES_ENABLED = true;

export type VoiceMiniPlayerProps = VoiceControlButtonProps;

const pillSx = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  paddingLeft: theme.spacing(1.5),
  borderRadius: theme.vars.shape.radiusPill,
  height: '2.75rem',
  border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  alignSelf: 'center',
  flexShrink: 0,
  boxSizing: 'border-box' as const,
  marginBottom: theme.spacing(2),
  marginTop: theme.spacing(2),
  background: theme.vars.palette.background.secondary,
});

const iconStyle = { width: '1rem', height: '1rem' };

export function VoiceMiniPlayer(props: VoiceMiniPlayerProps): ReactNode {
  if (!VOICE_FEATURES_ENABLED) return null;

  return (
    <Box
      data-testid="chat-voice-mini-player"
      sx={pillSx}
    >
      <MegaphoneIcon style={iconStyle} />
      <VoiceControlButton {...props} />
    </Box>
  );
}
