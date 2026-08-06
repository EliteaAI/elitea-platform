/**
 * Regression coverage for the storage-key alignment fix: this hook backs the
 * Settings > Profile "Play sound when tasks complete" toggle and must
 * read/write the SAME localStorage key as the code paths that actually play
 * a sound (`features/pipelines/lib/flow-editor/helpers/
 * pipelineCompletionSound.local.ts` and `features/toolkits/indexes/lib/
 * helpers/soundNotification.local.ts`), or toggling the switch off would not
 * silence anything.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '@/test/webstorage';
import { createStorage } from '@/shared/lib/storage';

import {
  notifyTaskComplete as notifyPipelineTaskComplete,
  resetSharedAudioContextForTests as resetPipelineAudioContext,
} from '@/features/pipelines/lib/flow-editor/helpers/pipelineCompletionSound.local';
import {
  notifyTaskComplete as notifyIndexesTaskComplete,
  resetSharedAudioContextForTests as resetIndexesAudioContext,
} from '@/features/toolkits/indexes/lib/helpers/soundNotification.local';

import {
  isPageInactive,
  playCompletionSound,
  playErrorSound,
  useSoundNotification,
} from './useSoundNotification';

installWebStorageShim();

/** Forces `isPageInactive()` (in both reference modules) to `true`, which is
 * the precondition under which they actually attempt to play a sound. */
function markPageInactive(): void {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
}

function restorePageVisibility(): void {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
}

/** Minimal spy-able stand-in for the Web Audio API so we can detect whether
 * a reference module actually attempted to construct an audio context
 * (i.e. got past its own `enabled` check) without producing real audio. */
function installFakeAudioContext(): ReturnType<typeof vi.fn> {
  const ctor = vi.fn().mockImplementation(() => ({
    currentTime: 0,
    state: 'running' as AudioContextState,
    createOscillator: () => ({
      connect: vi.fn(),
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      start: vi.fn(),
      stop: vi.fn(),
    }),
    createGain: () => ({
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    }),
    resume: () => Promise.resolve(),
  }));
  vi.stubGlobal('AudioContext', ctor);
  return ctor;
}

beforeEach(() => {
  window.localStorage.clear();
  resetPipelineAudioContext();
  resetIndexesAudioContext();
});

afterEach(() => {
  restorePageVisibility();
  vi.unstubAllGlobals();
});

describe('loadSoundConfig edge cases', () => {
  it('returns defaults when stored value is corrupt JSON', () => {
    const store = createStorage('local');
    store.set('notifications.sound-config', '{not-json!!!');
    const { result } = renderHook(() => useSoundNotification());
    expect(result.current.config).toEqual({ enabled: true, volume: 0.5 });
  });

  it('returns defaults when stored value is null-like JSON', () => {
    const store = createStorage('local');
    store.set('notifications.sound-config', 'null');
    const { result } = renderHook(() => useSoundNotification());
    expect(result.current.config).toEqual({ enabled: true, volume: 0.5 });
  });

  it('clamps volume to [0, 1] range', () => {
    const store = createStorage('local');
    store.set('notifications.sound-config', JSON.stringify({ enabled: true, volume: 5.0 }));
    const { result } = renderHook(() => useSoundNotification());
    expect(result.current.config.volume).toBe(1);
  });

  it('clamps negative volume to 0', () => {
    const store = createStorage('local');
    store.set('notifications.sound-config', JSON.stringify({ enabled: false, volume: -2 }));
    const { result } = renderHook(() => useSoundNotification());
    expect(result.current.config.volume).toBe(0);
  });

  it('falls back to default enabled when stored "enabled" is not boolean', () => {
    const store = createStorage('local');
    store.set('notifications.sound-config', JSON.stringify({ enabled: 'yes', volume: 0.5 }));
    const { result } = renderHook(() => useSoundNotification());
    expect(result.current.config.enabled).toBe(true);
  });

  it('falls back to default volume when stored "volume" is not number', () => {
    const store = createStorage('local');
    store.set('notifications.sound-config', JSON.stringify({ enabled: false, volume: 'loud' }));
    const { result } = renderHook(() => useSoundNotification());
    expect(result.current.config.volume).toBe(0.5);
  });
});

describe('playCompletionSound / playErrorSound standalone', () => {
  it('does not throw when AudioContext is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => playCompletionSound()).not.toThrow();
    expect(() => playErrorSound()).not.toThrow();
  });

  it('does not play sound when config.enabled is false', () => {
    const store = createStorage('local');
    store.set('notifications.sound-config', JSON.stringify({ enabled: false, volume: 0.5 }));
    const audioCtxCtor = installFakeAudioContext();
    playCompletionSound();
    expect(audioCtxCtor).not.toHaveBeenCalled();
  });
});

describe('isPageInactive', () => {
  it('returns true when document.hidden is true', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    expect(isPageInactive()).toBe(true);
  });

  it('returns true when document.hasFocus() returns false', () => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    expect(isPageInactive()).toBe(true);
  });

  it('returns false when page is visible and focused', () => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    expect(isPageInactive()).toBe(false);
  });
});

describe('useSoundNotification', () => {
  it('initializes config from storage', () => {
    const { result } = renderHook(() => useSoundNotification());
    expect(result.current.config).toEqual({ enabled: true, volume: 0.5 });
  });

  it('persists updates under the namespaced "el.notifications.sound-config" key', () => {
    const { result } = renderHook(() => useSoundNotification());
    act(() => {
      result.current.setConfig({ enabled: false, volume: 0.2 });
    });

    expect(window.localStorage.getItem('el.notifications.sound-config')).toBe(
      JSON.stringify({ enabled: false, volume: 0.2 }),
    );

    const store = createStorage('local');
    expect(store.getJSON('notifications.sound-config')).toEqual({ enabled: false, volume: 0.2 });
  });

  it('ignores a value already stored under the old "el.sound_notifications" key and falls back to defaults', () => {
    window.localStorage.setItem('el.sound_notifications', JSON.stringify({ enabled: false, volume: 0.1 }));

    const { result } = renderHook(() => useSoundNotification());

    expect(result.current.config).toEqual({ enabled: true, volume: 0.5 });
    expect(() => result.current.playCompletionSound()).not.toThrow();
  });

  it('setConfig merges updates, persists, and re-renders with the new value', () => {
    const { result } = renderHook(() => useSoundNotification());
    act(() => {
      result.current.setConfig({ enabled: false });
    });
    expect(result.current.config).toEqual({ enabled: false, volume: 0.5 });
  });

  it('setConfig is a partial merge — an earlier field survives a later unrelated update', () => {
    const { result } = renderHook(() => useSoundNotification());
    act(() => {
      result.current.setConfig({ volume: 0.9 });
    });
    act(() => {
      result.current.setConfig({ enabled: false });
    });
    expect(result.current.config).toEqual({ enabled: false, volume: 0.9 });
  });

  it('exposes playCompletionSound/playErrorSound (fire without throwing)', () => {
    const { result } = renderHook(() => useSoundNotification());
    expect(() => {
      result.current.playCompletionSound();
      result.current.playErrorSound();
    }).not.toThrow();
  });

  describe('cross-module key parity (pipelines / toolkits-indexes sound players)', () => {
    it('disabling via the hook silences pipelineCompletionSound.local.ts', () => {
      const audioCtxCtor = installFakeAudioContext();
      const { result } = renderHook(() => useSoundNotification());
      act(() => {
        result.current.setConfig({ enabled: false });
      });

      markPageInactive();
      notifyPipelineTaskComplete();

      expect(audioCtxCtor).not.toHaveBeenCalled();
    });

    it('disabling via the hook silences soundNotification.local.ts (toolkits/indexes)', () => {
      const audioCtxCtor = installFakeAudioContext();
      const { result } = renderHook(() => useSoundNotification());
      act(() => {
        result.current.setConfig({ enabled: false });
      });

      markPageInactive();
      notifyIndexesTaskComplete();

      expect(audioCtxCtor).not.toHaveBeenCalled();
    });

    it('enabling via the hook lets pipelineCompletionSound.local.ts proceed to play', () => {
      const audioCtxCtor = installFakeAudioContext();
      const { result } = renderHook(() => useSoundNotification());
      act(() => {
        result.current.setConfig({ enabled: true, volume: 0.7 });
      });

      markPageInactive();
      notifyPipelineTaskComplete();

      expect(audioCtxCtor).toHaveBeenCalled();
    });

    it('enabling via the hook lets soundNotification.local.ts (toolkits/indexes) proceed to play', () => {
      const audioCtxCtor = installFakeAudioContext();
      const { result } = renderHook(() => useSoundNotification());
      act(() => {
        result.current.setConfig({ enabled: true, volume: 0.7 });
      });

      markPageInactive();
      notifyIndexesTaskComplete();

      expect(audioCtxCtor).toHaveBeenCalled();
    });
  });
});
