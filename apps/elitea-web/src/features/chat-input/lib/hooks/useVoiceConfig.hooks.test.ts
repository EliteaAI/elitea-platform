import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installWebStorageShim } from '../../../../test/webstorage';

import { useVoiceConfig } from './useVoiceConfig.hooks';

installWebStorageShim();

beforeEach(() => {
  window.localStorage.clear();
});

describe('useVoiceConfig', () => {
  it('defaults to voiceName/voiceId null, rate 1.0, volume 1.0', () => {
    const { result } = renderHook(() => useVoiceConfig());
    expect(result.current.config).toEqual({ voiceName: null, voiceId: null, rate: 1.0, volume: 1.0 });
  });

  it('setConfig merges updates and persists under the new el.* namespace by default', () => {
    const { result } = renderHook(() => useVoiceConfig());
    act(() => {
      result.current.setConfig({ rate: 1.5 });
    });
    expect(result.current.config).toEqual({ voiceName: null, voiceId: null, rate: 1.5, volume: 1.0 });
    expect(window.localStorage.getItem('el.chat-input.voice-config')).not.toBeNull();
    expect(window.localStorage.getItem('elitea_voice_config')).toBeNull();
  });

  it('a fresh hook instance picks up a persisted config from storage', () => {
    const first = renderHook(() => useVoiceConfig());
    act(() => {
      first.result.current.setConfig({ voiceId: 'v-1', volume: 0.3 });
    });
    const second = renderHook(() => useVoiceConfig());
    expect(second.result.current.config).toEqual({ voiceName: null, voiceId: 'v-1', rate: 1.0, volume: 0.3 });
  });

  it('persist:false keeps updates in memory only — nothing written to storage', () => {
    const { result } = renderHook(() => useVoiceConfig({ persist: false }));
    act(() => {
      result.current.setConfig({ rate: 0.5 });
    });
    expect(result.current.config.rate).toBe(0.5);
    expect(window.localStorage.getItem('el.chat-input.voice-config')).toBeNull();
  });

  it('clamps an out-of-range persisted rate/volume into [0.5, 2] / [0, 1]', () => {
    window.localStorage.setItem('el.chat-input.voice-config', JSON.stringify({ rate: 99, volume: -5 }));
    const { result } = renderHook(() => useVoiceConfig());
    expect(result.current.config.rate).toBe(2);
    expect(result.current.config.volume).toBe(0);
  });

  it('falls back to defaults for malformed persisted JSON', () => {
    window.localStorage.setItem('el.chat-input.voice-config', 'not json');
    const { result } = renderHook(() => useVoiceConfig());
    expect(result.current.config).toEqual({ voiceName: null, voiceId: null, rate: 1.0, volume: 1.0 });
  });

  it('falls back per-field when a stored field has the wrong type', () => {
    window.localStorage.setItem(
      'el.chat-input.voice-config',
      JSON.stringify({ voiceName: 42, voiceId: true, rate: 'fast', volume: 'loud' }),
    );
    const { result } = renderHook(() => useVoiceConfig());
    expect(result.current.config).toEqual({ voiceName: null, voiceId: null, rate: 1.0, volume: 1.0 });
  });

  it('setConfig is a partial merge — an earlier field survives a later unrelated update', () => {
    const { result } = renderHook(() => useVoiceConfig());
    act(() => {
      result.current.setConfig({ rate: 1.8 });
    });
    act(() => {
      result.current.setConfig({ volume: 0.2 });
    });
    expect(result.current.config).toEqual({ voiceName: null, voiceId: null, rate: 1.8, volume: 0.2 });
  });
});

describe('useVoiceConfig browser voices', () => {
  function makeVoice(name: string): SpeechSynthesisVoice {
    return { name, lang: 'en-US', localService: true, default: false, voiceURI: name };
  }

  // jsdom has no `speechSynthesis` global at all by default (`'speechSynthesis'
  // in window` is false) — deleting the property (not assigning `undefined`,
  // which would itself create an own property and make `in` true) reproduces
  // that baseline for the "unavailable" test.
  afterEach(() => {
    Reflect.deleteProperty(window, 'speechSynthesis');
  });

  it('does nothing (empty browserVoices, no throw) when speechSynthesis is unavailable (jsdom default)', () => {
    expect('speechSynthesis' in window).toBe(false);
    const { result } = renderHook(() => useVoiceConfig());
    expect(result.current.browserVoices).toEqual([]);
    expect(result.current.resolvedBrowserVoice).toBeNull();
  });

  it('loads voices from speechSynthesis.getVoices() and resolves the configured voice by name', () => {
    const voices = [makeVoice('Alpha'), makeVoice('Beta')];
    // @ts-expect-error -- minimal test double, not the full SpeechSynthesis interface.
    window.speechSynthesis = {
      getVoices: () => voices,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    // Unmounted explicitly (not left to the automatic post-test cleanup):
    // this file's own `afterEach` above deletes `window.speechSynthesis`
    // before that automatic cleanup runs (nested-`describe` `afterEach`
    // hooks run before file-scope ones), which would otherwise crash this
    // hook's unmount-time `removeEventListener` cleanup on an already-gone
    // global.
    const { result, unmount } = renderHook(() => useVoiceConfig());
    expect(result.current.browserVoices).toEqual(voices);
    // No configured voiceName yet — falls back to the first available voice.
    expect(result.current.resolvedBrowserVoice).toBe(voices[0]);

    act(() => {
      result.current.setConfig({ voiceName: 'Beta' });
    });
    expect(result.current.resolvedBrowserVoice).toBe(voices[1]);
    unmount();
  });
});
