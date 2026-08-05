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

import { useSoundNotification } from './useSoundNotification';

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
