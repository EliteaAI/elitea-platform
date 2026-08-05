import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../test/webstorage';
import { renderWithProviders } from '../__tests__/testUtils';
import type { VoiceConfig } from '../lib/hooks/useVoiceConfig.hooks';

import { VoiceMiniPlayer } from './VoiceMiniPlayer';

// `VoiceMiniPlayer` forwards straight through to `VoiceControlButton`, which
// renders the real `VoiceConfigDialog` (`persist: true` `useVoiceConfig()`
// touches `localStorage`) — see `VoiceControlButton.test.tsx`'s own comment.
installWebStorageShim();

const CONFIG: VoiceConfig = { voiceName: null, voiceId: null, rate: 1, volume: 1 };

describe('VoiceMiniPlayer', () => {
  it('renders the pill container and forwards props to VoiceControlButton', () => {
    renderWithProviders(
      <VoiceMiniPlayer
        isPlaying={false}
        onPlay={vi.fn()}
        onStop={vi.fn()}
        voiceConfig={CONFIG}
        voices={[]}
        onVoiceConfigChange={vi.fn()}
        ttsModel={null}
        hasModelTTS={false}
      />,
    );

    expect(screen.getByTestId('chat-voice-mini-player')).toBeInTheDocument();
    expect(screen.getByTestId('chat-voice-play-stop-button')).toBeInTheDocument();
  });
});
