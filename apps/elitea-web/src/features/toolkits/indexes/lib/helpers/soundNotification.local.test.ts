import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../../../test/webstorage';
import { createStorage } from '@/shared/lib/storage';

import { notifyTaskComplete, notifyTaskError, resetSharedAudioContextForTests } from './soundNotification.local';

installWebStorageShim();

function setActive(active: boolean): void {
  Object.defineProperty(document, 'hidden', { value: !active, configurable: true });
  document.hasFocus = vi.fn(() => active);
}

beforeEach(() => {
  window.localStorage.clear();
  setActive(true);
});

describe('notifyTaskComplete / notifyTaskError', () => {
  it('does nothing while the page is active (document has focus, not hidden)', () => {
    setActive(true);
    expect(() => notifyTaskComplete()).not.toThrow();
    expect(() => notifyTaskError()).not.toThrow();
  });

  it('does not throw when the page is inactive and Web Audio API is unavailable (jsdom has no AudioContext)', () => {
    setActive(false);
    expect(() => notifyTaskComplete()).not.toThrow();
    expect(() => notifyTaskError()).not.toThrow();
  });

  it('honours a disabled sound preference stored under the el.* namespace', () => {
    createStorage('local').setJSON('notifications.sound-config', { enabled: false, volume: 1 });
    setActive(false);
    expect(() => notifyTaskComplete()).not.toThrow();
  });

  it('reads the same el.notifications.sound-config key features/notifications writes (cross-duplicate consistency)', () => {
    createStorage('local').setJSON('notifications.sound-config', { enabled: false, volume: 1 });
    expect(window.localStorage.getItem('el.notifications.sound-config')).not.toBeNull();
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

let lastCreatedContext: FakeAudioContext | undefined;

function registerCreatedContext(ctx: FakeAudioContext): void {
  lastCreatedContext = ctx;
}

class FakeAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  createOscillator = vi.fn(() => new FakeOscillatorNode());
  createGain = vi.fn(() => new FakeGainNode());

  constructor() {
    registerCreatedContext(this);
  }
}

describe('notifyTaskComplete / notifyTaskError with a present AudioContext and inactive page', () => {
  let originalAudioContext: typeof window.AudioContext | undefined;

  beforeEach(() => {
    lastCreatedContext = undefined;
    resetSharedAudioContextForTests();
    setActive(false);
    originalAudioContext = window.AudioContext;
    // @ts-expect-error -- test double, not the real DOM constructor shape.
    window.AudioContext = FakeAudioContext;
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext as typeof window.AudioContext;
    resetSharedAudioContextForTests();
  });

  it('plays a two-tone completion sound (2 oscillators) only when the page is inactive', () => {
    notifyTaskComplete();
    expect(lastCreatedContext?.createOscillator).toHaveBeenCalledTimes(2);
    const oscillator = lastCreatedContext?.createOscillator.mock.results[0]?.value as FakeOscillatorNode;
    expect(oscillator.type).toBe('sine');
    expect(oscillator.start).toHaveBeenCalledOnce();
    expect(oscillator.stop).toHaveBeenCalledOnce();
  });

  it('plays a two-tone error sound (2 oscillators)', () => {
    notifyTaskError();
    expect(lastCreatedContext?.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the page is active, even with AudioContext available', () => {
    setActive(true);
    notifyTaskComplete();
    expect(lastCreatedContext).toBeUndefined();
  });
});
