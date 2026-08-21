import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../test/webstorage';
import { renderWithProviders } from '../__tests__/testUtils';
import type { VoiceConfig } from '../lib/hooks/useVoiceConfig.hooks';

import { VoiceMiniPlayer } from './VoiceMiniPlayer';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
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
  // The generated client needs a base URL, or the platform-settings read never
  // reaches MSW and the flags stay at their in-flight "enabled" default.
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(
    http.get('*/elitea_core/platform_settings/prompt_lib', () =>
      HttpResponse.json({ voice_features_enabled: true, voice_features_temporarily_disabled: false }),
    ),
  );
});

afterEach(() => {
  resetGeneratedClient();
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

  // The defect: `VoiceMiniPlayer` held its own `const VOICE_FEATURES_ENABLED =
  // true` module constant, so the admin Voice Features switch could not reach
  // it. Its child `VoiceControlButton` already read the real flag and returned
  // null. That left the bordered pill on screen with only the megaphone icon
  // inside it. The operator had just switched off this now empty control.
  it('renders nothing once an administrator switches voice off', async () => {
    server.use(
      http.get('*/elitea_core/platform_settings/prompt_lib', () =>
        HttpResponse.json({ voice_features_enabled: false, voice_features_temporarily_disabled: false }),
      ),
    );

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

    await waitFor(() => {
      expect(screen.queryByTestId('chat-voice-mini-player')).not.toBeInTheDocument();
    });
  });
});
