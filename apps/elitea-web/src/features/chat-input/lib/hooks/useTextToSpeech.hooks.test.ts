import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSocketClient, type TestSocketClient } from '@/shared/api/socket/testing';

import { useTextToSpeech } from './useTextToSpeech.hooks';
import type { TtsModel } from './useTextToSpeech.types';

const TTS_MODEL: TtsModel = { id: 'p1_voice-model', name: 'voice-model', project_id: 'p1' };

describe('useTextToSpeech — backend selection', () => {
  let client: TestSocketClient;
  let originalAudioContext: typeof window.AudioContext | undefined;

  beforeEach(() => {
    client = createTestSocketClient();
    originalAudioContext = window.AudioContext;
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext as typeof window.AudioContext;
    vi.unstubAllGlobals();
  });

  it('with no ttsModel/socket/AudioContext, falls back to the browser engine (isSupported reflects speechSynthesis only)', () => {
    Reflect.deleteProperty(window, 'AudioContext');
    Reflect.deleteProperty(window, 'speechSynthesis');
    const { result } = renderHook(() => useTextToSpeech({}));
    expect(result.current.isSupported).toBe(false);
  });

  it('isSupported is true when speechSynthesis exists, even with no model/socket', () => {
    Reflect.deleteProperty(window, 'AudioContext');
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() });
    const { result } = renderHook(() => useTextToSpeech({}));
    expect(result.current.isSupported).toBe(true);
  });

  /** A minimally-functional `AudioContext` stand-in — `useModelTtsEngine`'s `speak()` calls `createGain()`/`.connect()` synchronously, so `isAudioContextSupported()` alone (an empty class) is not enough here, unlike the "falls back" tests below which never get that far. */
  class MinimalFakeAudioContext {
    state = 'running';
    currentTime = 0;
    createGain(): { gain: { value: number }; connect: () => void } {
      return { gain: { value: 1 }, connect: () => {} };
    }
    close(): Promise<void> {
      this.state = 'closed';
      return Promise.resolve();
    }
  }

  it('with a ttsModel + socket + AudioContext all present, speak() drives the MODEL engine (emits tts_start over the socket)', () => {
    vi.stubGlobal('AudioContext', MinimalFakeAudioContext);
    const { result } = renderHook(() => useTextToSpeech({ ttsModel: TTS_MODEL, socket: client, voiceConfig: {} }));

    act(() => result.current.speak('Hello'));

    expect(client.getEmitted('tts_start')).toHaveLength(1);
    expect(result.current.isPlaying).toBe(true);
  });

  it('missing socket (even with a ttsModel + AudioContext) falls back to the browser engine — no socket emit', () => {
    vi.stubGlobal('AudioContext', MinimalFakeAudioContext);
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      },
    );

    const { result } = renderHook(() => useTextToSpeech({ ttsModel: TTS_MODEL, socket: null, voiceConfig: {} }));
    act(() => result.current.speak('Hello'));

    expect(speak).toHaveBeenCalledOnce();
  });

  it('speak("") is a no-op regardless of backend', () => {
    const { result } = renderHook(() => useTextToSpeech({}));
    act(() => result.current.speak(''));
    expect(result.current.isPlaying).toBe(false);
  });

  it('setShowPlayer/setSpeakableText/speakableText round-trip (the UI-facing player state this hook owns)', () => {
    const { result } = renderHook(() => useTextToSpeech({}));
    act(() => {
      result.current.setSpeakableText('spoken text');
      result.current.setShowPlayer(true);
    });
    expect(result.current.speakableText).toBe('spoken text');
    expect(result.current.showPlayer).toBe(true);
  });

  it('stop() resets speakableText/showPlayer, matching baseline\'s unconditional resetStatus("idle") — an explicit Stop must not leave stale text for a later onPlay to silently replay', () => {
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    const { result } = renderHook(() => useTextToSpeech({}));
    act(() => {
      result.current.setSpeakableText('spoken text');
      result.current.setShowPlayer(true);
      result.current.speak('spoken text');
    });

    act(() => result.current.stop());

    expect(result.current.speakableText).toBe('');
    expect(result.current.showPlayer).toBe(false);
  });
});
