import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../test/webstorage';
import { createStorage } from '@/shared/lib/storage';

import {
  loadSoundConfig,
  playCompletionSound,
  playErrorSound,
  resetSharedAudioContextForTests,
  saveSoundConfig,
} from './soundNotification';

installWebStorageShim();

beforeEach(() => {
  window.localStorage.clear();
});

describe('loadSoundConfig', () => {
  it('returns the default config when nothing is stored', () => {
    expect(loadSoundConfig()).toEqual({ enabled: true, volume: 0.5 });
  });

  it('round-trips a saved config', () => {
    saveSoundConfig({ enabled: false, volume: 0.2 });
    expect(loadSoundConfig()).toEqual({ enabled: false, volume: 0.2 });
  });

  it('falls back to defaults for a malformed stored value (soundNotification.utils.js:8-18 parity)', () => {
    createStorage('local').set('notifications.sound-config', 'not json');
    expect(loadSoundConfig()).toEqual({ enabled: true, volume: 0.5 });
  });

  it('clamps an out-of-range stored volume into [0, 1]', () => {
    createStorage('local').setJSON('notifications.sound-config', { enabled: true, volume: 5 });
    expect(loadSoundConfig().volume).toBe(1);
    createStorage('local').setJSON('notifications.sound-config', { enabled: true, volume: -3 });
    expect(loadSoundConfig().volume).toBe(0);
  });

  it('falls back per-field when a stored field has the wrong type', () => {
    createStorage('local').setJSON('notifications.sound-config', { enabled: 'yes', volume: 'loud' });
    expect(loadSoundConfig()).toEqual({ enabled: true, volume: 0.5 });
  });

  it('stores under the new el.* namespace, not the legacy raw key', () => {
    saveSoundConfig({ enabled: false, volume: 0.1 });
    expect(window.localStorage.getItem('elitea_ui.sound_notifications')).toBeNull();
    expect(window.localStorage.getItem('el.notifications.sound-config')).not.toBeNull();
  });

  it('reads only its own key, not the Settings duplicate\'s key (regression guard — documents the confirmed cross-duplicate mismatch: see module doc comment)', () => {
    // `shared/lib/hooks/useSoundNotification.ts` — the Settings > Profile
    // "Play sound when tasks complete" toggle's actual implementation —
    // persists under this different raw key today. A disabled preference
    // written there must not leak into (or be silently picked up by) this
    // module's own config; this module scopes strictly to its own key.
    window.localStorage.setItem('el.sound_notifications', JSON.stringify({ enabled: false, volume: 0 }));
    expect(loadSoundConfig()).toEqual({ enabled: true, volume: 0.5 });
  });
});

describe('playCompletionSound / playErrorSound', () => {
  it('do not throw when Web Audio API is unavailable (jsdom has no AudioContext)', () => {
    expect(() => playCompletionSound()).not.toThrow();
    expect(() => playErrorSound()).not.toThrow();
  });

  it('do nothing (no throw, silent no-op) when sound is disabled', () => {
    saveSoundConfig({ enabled: false, volume: 1 });
    expect(() => playCompletionSound()).not.toThrow();
  });
});

/* ── Web Audio API present: a minimal fake exercising the real tone-building path ── */

class FakeAudioParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeOscillatorNode {
  type = '';
  frequency = new FakeAudioParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect = vi.fn();
}

/** Set by the most recently constructed `FakeAudioContext` — the module under test keeps its own instance private, so tests grab it here instead. */
let lastCreatedContext: FakeAudioContext | undefined;

function registerCreatedContext(ctx: FakeAudioContext): void {
  lastCreatedContext = ctx;
}

class FakeAudioContext {
  state: 'running' | 'suspended' | 'closed';
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  createOscillator = vi.fn(() => new FakeOscillatorNode());
  createGain = vi.fn(() => new FakeGainNode());

  constructor(initialState: 'running' | 'suspended' | 'closed' = 'running') {
    this.state = initialState;
    registerCreatedContext(this);
  }
}

describe('playCompletionSound / playErrorSound with a present AudioContext', () => {
  let originalAudioContext: typeof window.AudioContext | undefined;

  beforeEach(() => {
    lastCreatedContext = undefined;
    resetSharedAudioContextForTests();
    originalAudioContext = window.AudioContext;
    // @ts-expect-error -- test double, not the real DOM constructor shape.
    window.AudioContext = FakeAudioContext;
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext as typeof window.AudioContext;
    resetSharedAudioContextForTests();
  });

  it('creates and wires an oscillator + gain node per tone (2 tones for completion)', () => {
    playCompletionSound();
    expect(lastCreatedContext?.createOscillator).toHaveBeenCalledTimes(2);
    expect(lastCreatedContext?.createGain).toHaveBeenCalledTimes(2);
    const oscillator = lastCreatedContext?.createOscillator.mock.results[0]?.value as FakeOscillatorNode;
    expect(oscillator.type).toBe('sine');
    expect(oscillator.connect).toHaveBeenCalledOnce();
    expect(oscillator.start).toHaveBeenCalledOnce();
    expect(oscillator.stop).toHaveBeenCalledOnce();
  });

  it('plays 2 tones for playErrorSound too (descending pair)', () => {
    playErrorSound();
    expect(lastCreatedContext?.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('reuses the same context across two calls instead of constructing a new one each time', () => {
    playCompletionSound();
    const first = lastCreatedContext;
    playCompletionSound();
    expect(lastCreatedContext).toBe(first);
  });

  it('resumes a suspended context (background-tab auto-suspend path)', () => {
    class SuspendedAudioContext extends FakeAudioContext {
      constructor() {
        super('suspended');
      }
    }
    // @ts-expect-error -- test double.
    window.AudioContext = SuspendedAudioContext;
    playCompletionSound();
    expect(lastCreatedContext?.resume).toHaveBeenCalledOnce();
  });

  it('does not throw when the AudioContext constructor itself throws (Web Audio unavailable at runtime despite being declared)', () => {
    class ThrowingAudioContext {
      constructor() {
        throw new Error('no audio hardware');
      }
    }
    // @ts-expect-error -- test double.
    window.AudioContext = ThrowingAudioContext;
    expect(() => playCompletionSound()).not.toThrow();
  });

  it('prefers webkitAudioContext when window.AudioContext is absent', () => {
    // @ts-expect-error -- deliberately undefined for this branch.
    window.AudioContext = undefined;
    const withWebkit = window as unknown as { webkitAudioContext?: typeof window.AudioContext };
    withWebkit.webkitAudioContext = FakeAudioContext as unknown as typeof window.AudioContext;
    expect(() => playCompletionSound()).not.toThrow();
    delete withWebkit.webkitAudioContext;
  });
});
