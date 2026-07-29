import { useState } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSocketClient, type TestSocketClient } from '@/shared/api/socket/testing';

import { useModelTtsEngine, type UseModelTtsEngineParams } from './useModelTtsEngine.hooks';
import type { TtsModel, TtsSpokenRange, TtsStatus } from './useTextToSpeech.types';

/* ── FakeAudioContext — controllable currentTime, no real audio hardware ── */

class FakeGainNode {
  gain = { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  connect = vi.fn();
}

class FakeBufferSource {
  buffer: unknown;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioBuffer {
  readonly duration: number;
  constructor(
    _channels: number,
    length: number,
    sampleRate: number,
  ) {
    this.duration = length / sampleRate;
  }
  copyToChannel = vi.fn();
}

let lastCreatedContext: FakeAudioContext | undefined;

class FakeAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  outputLatency = 0;
  destination = {};
  createGain = (): FakeGainNode => new FakeGainNode();
  createBuffer = (channels: number, length: number, sampleRate: number): FakeAudioBuffer => new FakeAudioBuffer(channels, length, sampleRate);
  createBufferSource = (): FakeBufferSource => new FakeBufferSource();
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  suspend = vi.fn(() => {
    this.state = 'suspended';
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
  constructor() {
    // eslint-disable-next-line typescript/no-this-alias -- test double: records the instance under construction so assertions can reach it, not a pre-ES2015 scope workaround.
    lastCreatedContext = this;
  }
}

/* ── requestAnimationFrame — a manually-driven queue instead of real frame timing ── */

let rafQueue: Map<number, FrameRequestCallback>;
let rafNextId: number;

function stubRaf(): void {
  rafQueue = new Map();
  rafNextId = 1;
  // `vi.stubGlobal` (not a bare `window.foo =` assignment): the hook under
  // test calls the UNQUALIFIED `requestAnimationFrame`/`cancelAnimationFrame`
  // identifiers, which resolve through Node's global scope in vitest's jsdom
  // project rather than always aliasing `window`'s own property — matches
  // this codebase's own established global-stubbing idiom.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = rafNextId++;
    rafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    rafQueue.delete(id);
  });
}

/** Runs every currently-queued rAF callback once (callbacks that themselves queue a new frame appear in the NEXT flush, not this one). */
function flushRaf(): void {
  const due = [...rafQueue.entries()];
  rafQueue.clear();
  for (const [, cb] of due) cb(0);
}

function int16LEBuffer(samples: readonly number[]): ArrayBuffer {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return buf;
}

const TTS_MODEL: TtsModel = { id: 'p1_voice-model', name: 'voice-model', project_id: 'p1', default: true };

interface Harness {
  readonly speak: (text: string) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly stop: () => void;
  readonly status: TtsStatus;
  readonly spokenRange: TtsSpokenRange | null;
}

function useHarness(params: Omit<UseModelTtsEngineParams, 'status' | 'setStatus' | 'setSpokenRange' | 'onFinished'> & { onFinished?: (s: 'done' | 'error' | 'idle') => void }): Harness {
  const [status, setStatus] = useState<TtsStatus>('idle');
  const [spokenRange, setSpokenRange] = useState<TtsSpokenRange | null>(null);
  const engine = useModelTtsEngine({
    ...params,
    status,
    setStatus,
    setSpokenRange,
    onFinished: params.onFinished ?? (() => {}),
  });
  return { ...engine, status, spokenRange };
}

describe('useModelTtsEngine', () => {
  let originalAudioContext: typeof window.AudioContext | undefined;
  let client: TestSocketClient;

  beforeEach(() => {
    vi.useFakeTimers();
    originalAudioContext = window.AudioContext;
    // @ts-expect-error -- test double, not the real DOM constructor shape.
    window.AudioContext = FakeAudioContext;
    stubRaf();
    client = createTestSocketClient();
    lastCreatedContext = undefined;
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext as typeof window.AudioContext;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('when disabled, speak/pause/resume/stop are no-ops', () => {
    const { result } = renderHook(() => useHarness({ enabled: false, ttsModel: TTS_MODEL, socket: client, voiceConfig: {} }));
    act(() => result.current.speak('hello'));
    expect(client.getEmitted()).toEqual([]);
    expect(result.current.status).toBe('idle');
  });

  it('speak() emits tts_stop then tts_start with the model/voice/text payload, and sets status to playing', () => {
    const { result } = renderHook(() =>
      useHarness({ enabled: true, ttsModel: TTS_MODEL, socket: client, voiceConfig: { voiceId: 'v-1', rate: 1.5, volume: 0.8 } }),
    );
    act(() => result.current.speak('Hello world'));

    expect(client.getEmitted('tts_stop')).toHaveLength(1);
    expect(client.getEmitted('tts_start')).toEqual([
      {
        event: 'tts_start',
        payload: {
          project_id: 'p1',
          model_name: 'voice-model',
          model_project_id: 'p1',
          text: 'Hello world',
          voice: 'v-1',
          speed: 1.5,
        },
      },
    ]);
    expect(result.current.status).toBe('playing');
  });

  it('an empty text or a missing ttsModel/socket does not emit or change status', () => {
    const { result: noText } = renderHook(() => useHarness({ enabled: true, ttsModel: TTS_MODEL, socket: client, voiceConfig: {} }));
    act(() => noText.current.speak(''));
    expect(client.getEmitted()).toEqual([]);

    const { result: noModel } = renderHook(() => useHarness({ enabled: true, ttsModel: null, socket: client, voiceConfig: {} }));
    act(() => noModel.current.speak('hi'));
    expect(client.getEmitted()).toEqual([]);
  });

  it('drives a full chunk -> final done -> scheduler -> RAF playback to the done status', () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useHarness({ enabled: true, ttsModel: TTS_MODEL, socket: client, voiceConfig: {}, onFinished }));

    act(() => result.current.speak('Hi'));
    expect(lastCreatedContext).toBeDefined();

    // One small audio chunk, then the final tts_done (no char_end).
    act(() =>
      client.simulateServerEvent('tts_audio_chunk', { audio: int16LEBuffer(Array.from({ length: 240 }, () => 1000)), sample_rate: 24000 }),
    );
    act(() => client.simulateServerEvent('tts_done', {}));

    // Scheduler tick (setInterval 25ms): finalTtsDone bypasses the pre-roll
    // wait, so the single buffered segment is scheduled immediately.
    act(() => {
      vi.advanceTimersByTime(25);
    });

    // First RAF frame: still "before" totalDuration has elapsed (currentTime
    // is still 0, same as playStartTime) — reports playing, not done yet.
    act(() => flushRaf());
    expect(result.current.status).toBe('playing');

    // Advance the fake clock well past any real duration this tiny chunk
    // could have, then let the next frame observe it.
    const ctx = lastCreatedContext;
    expect(ctx).toBeDefined();
    if (ctx) ctx.currentTime = 999;
    act(() => flushRaf());

    expect(result.current.status).toBe('done');
    expect(result.current.spokenRange).toBeNull();
    expect(onFinished).toHaveBeenCalledWith('done');
    expect(ctx?.close).toHaveBeenCalled();
  });

  it('pause() suspends the AudioContext and sets status to paused; resume() resumes it and sets status back to playing', () => {
    const { result } = renderHook(() => useHarness({ enabled: true, ttsModel: TTS_MODEL, socket: client, voiceConfig: {} }));
    act(() => result.current.speak('Hi'));

    act(() => result.current.pause());
    expect(result.current.status).toBe('paused');
    expect(lastCreatedContext?.suspend).toHaveBeenCalled();

    act(() => result.current.resume());
    expect(result.current.status).toBe('playing');
    expect(lastCreatedContext?.resume).toHaveBeenCalled();
  });

  it('pause() while not playing, and resume() while not paused, are no-ops', () => {
    const { result } = renderHook(() => useHarness({ enabled: true, ttsModel: TTS_MODEL, socket: client, voiceConfig: {} }));
    act(() => result.current.pause());
    expect(result.current.status).toBe('idle');
    act(() => result.current.resume());
    expect(result.current.status).toBe('idle');
  });

  it('stop() emits tts_stop, closes the AudioContext, resets status to idle, and calls onFinished("idle") to reset the player UI', () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() =>
      useHarness({ enabled: true, ttsModel: TTS_MODEL, socket: client, voiceConfig: {}, onFinished }),
    );
    act(() => result.current.speak('Hi'));
    client.clearEmitted();

    act(() => result.current.stop());

    expect(client.getEmitted('tts_stop')).toHaveLength(1);
    expect(lastCreatedContext?.close).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.spokenRange).toBeNull();
    expect(onFinished).toHaveBeenCalledWith('idle');
  });

  it('a tts_error event stops playback, sets status to error, and calls onFinished("error")', () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useHarness({ enabled: true, ttsModel: TTS_MODEL, socket: client, voiceConfig: {}, onFinished }));
    act(() => result.current.speak('Hi'));

    act(() => client.simulateServerEvent('tts_error', { error: 'synthesis failed' }));

    expect(result.current.status).toBe('error');
    expect(result.current.spokenRange).toBeNull();
    expect(onFinished).toHaveBeenCalledWith('error');
  });
});
