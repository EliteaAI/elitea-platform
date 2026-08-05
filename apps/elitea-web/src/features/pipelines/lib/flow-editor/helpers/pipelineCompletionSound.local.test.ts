import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../../../test/webstorage';
import { createStorage } from '@/shared/lib/storage';

import { notifyTaskComplete, resetSharedAudioContextForTests } from './pipelineCompletionSound.local';

installWebStorageShim();

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

interface FakeAudioContextInstance {
  state: 'running' | 'suspended' | 'closed';
  currentTime: number;
  destination: object;
  resume: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
}

let lastCreatedContext: FakeAudioContextInstance | undefined;

/**
 * A plain constructor FUNCTION (not a `class`) that explicitly `return`s its
 * instance object rather than relying on `this` — avoids `no-this-alias`
 * (aliasing `this` to the module-level `lastCreatedContext` tracker) while
 * keeping the same `new FakeAudioContext()` construction shape the module
 * under test uses.
 */
function FakeAudioContext(this: unknown): FakeAudioContextInstance {
  const instance: FakeAudioContextInstance = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => new FakeOscillatorNode()),
    createGain: vi.fn(() => new FakeGainNode()),
  };
  lastCreatedContext = instance;
  return instance;
}

describe('notifyTaskComplete', () => {
  let originalAudioContext: typeof window.AudioContext | undefined;
  let originalHasFocus: typeof document.hasFocus;
  let originalHidden: PropertyDescriptor | undefined;

  beforeEach(() => {
    window.localStorage.clear();
    lastCreatedContext = undefined;
    resetSharedAudioContextForTests();
    originalAudioContext = window.AudioContext;
    // @ts-expect-error -- test double, not the real DOM constructor shape.
    window.AudioContext = FakeAudioContext;
    originalHasFocus = document.hasFocus.bind(document);
    originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext as typeof window.AudioContext;
    document.hasFocus = originalHasFocus;
    if (originalHidden) {
      Object.defineProperty(document, 'hidden', originalHidden);
    }
    resetSharedAudioContextForTests();
  });

  it('does nothing when the page is active (default jsdom focus/visibility)', () => {
    document.hasFocus = () => true;
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    notifyTaskComplete();

    expect(lastCreatedContext).toBeUndefined();
  });

  it('plays the completion tone (2 tones) when the tab is hidden', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    notifyTaskComplete();

    expect(lastCreatedContext?.createOscillator).toHaveBeenCalledTimes(2);
    const oscillator = lastCreatedContext?.createOscillator.mock.results[0]?.value as FakeOscillatorNode;
    expect(oscillator.type).toBe('sine');
    expect(oscillator.start).toHaveBeenCalledOnce();
  });

  it('plays the completion tone when the window has lost focus even while nominally visible', () => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.hasFocus = () => false;

    notifyTaskComplete();

    expect(lastCreatedContext?.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('respects a disabled sound preference even while the tab is hidden', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    createStorage('local').setJSON('notifications.sound-config', { enabled: false, volume: 1 });

    notifyTaskComplete();

    expect(lastCreatedContext).toBeUndefined();
  });

  it('does not throw when Web Audio API is unavailable', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    // @ts-expect-error -- simulating absence.
    window.AudioContext = undefined;

    expect(() => notifyTaskComplete()).not.toThrow();
  });
});
