import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../test/webstorage';
import { renderWithProviders } from '../__tests__/testUtils';
import type { VoiceConfig } from '../lib/hooks/useVoiceConfig.hooks';

import { VoiceMiniPlayer } from './VoiceMiniPlayer';
import { server } from '@/test/setup';

// `VoiceMiniPlayer` forwards straight through to `VoiceControlButton`, which
// renders the real `VoiceConfigDialog` (`persist: true` `useVoiceConfig()`
// touches `localStorage`) — see `VoiceControlButton.test.tsx`'s own comment.
installWebStorageShim();

const CONFIG: VoiceConfig = { voiceName: null, voiceId: null, rate: 1, volume: 1 };

// `VoiceControlButton` reads the platform's Voice Features switches
// (`useVoiceFeatureFlags`, A14/issue 200) — it used to hardcode them as module
// constants. That is a real network read, and `src/test/setup.ts` runs MSW with
// `onUnhandledRequest: 'error'`, so the endpoint is stubbed here rather than
// left to race the test's own teardown.
beforeEach(() => {
  server.use(
    http.get('*/elitea_core/platform_settings/prompt_lib', () =>
      HttpResponse.json({ voice_features_enabled: true, voice_features_temporarily_disabled: false }),
    ),
  );
});

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
