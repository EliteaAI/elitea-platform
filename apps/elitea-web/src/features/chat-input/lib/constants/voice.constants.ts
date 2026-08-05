/**
 * Ported verbatim from
 * apps/elitea-ui/src/[fsd]/features/chat/voice-config/constants/voice.constants.js
 * (3 trivial constants — no behavioral changes).
 */

export const VOICE_PREVIEW_TEXT = 'Hello! This is a preview of how your text will sound.';

export interface VoiceSliderMark {
  readonly value: number;
  readonly label: string;
}

export const VOICE_SPEED_MARKS: readonly VoiceSliderMark[] = [
  { value: 0.5, label: '0.5x' },
  { value: 1.0, label: '1x' },
  { value: 2.0, label: '2x' },
];

export const VOICE_VOLUME_MARKS: readonly VoiceSliderMark[] = [
  { value: 0, label: 'Mute' },
  { value: 0.5, label: '50%' },
  { value: 1, label: '100%' },
];
