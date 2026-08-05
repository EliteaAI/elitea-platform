import { useState } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBrowserTtsEngine, type UseBrowserTtsEngineParams } from './useBrowserTtsEngine.hooks';
import type { TtsSpokenRange, TtsStatus } from './useTextToSpeech.types';

/* ── SpeechSynthesis / SpeechSynthesisUtterance test doubles ────────────── */

interface FakeUtterance {
  text: string;
  voice: unknown;
  rate: number;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onboundary: ((e: { name: string; charIndex: number; charLength?: number }) => void) | null;
}

let lastUtterance: FakeUtterance | undefined;
const speakMock = vi.fn();
const cancelMock = vi.fn();

function stubSpeechSynthesis(): void {
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string;
      voice: unknown = null;
      rate = 1;
      volume = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onboundary: ((e: { name: string; charIndex: number; charLength?: number }) => void) | null = null;
      constructor(text: string) {
        this.text = text;
        // eslint-disable-next-line typescript/no-this-alias -- test double: records the instance under construction so assertions can reach it.
        lastUtterance = this;
      }
    },
  );
  vi.stubGlobal('speechSynthesis', { speak: speakMock, cancel: cancelMock });
}

interface Harness {
  readonly speak: (text: string) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly stop: () => void;
  readonly status: TtsStatus;
  readonly spokenRange: TtsSpokenRange | null;
}

function useHarness(params: Omit<UseBrowserTtsEngineParams, 'status' | 'setStatus' | 'setSpokenRange' | 'onFinished'> & { onFinished?: (s: 'done' | 'error' | 'idle') => void }): Harness {
  const [status, setStatus] = useState<TtsStatus>('idle');
  const [spokenRange, setSpokenRange] = useState<TtsSpokenRange | null>(null);
  const engine = useBrowserTtsEngine({ ...params, status, setStatus, setSpokenRange, onFinished: params.onFinished ?? (() => {}) });
  return { ...engine, status, spokenRange };
}

describe('useBrowserTtsEngine', () => {
  beforeEach(() => {
    lastUtterance = undefined;
    speakMock.mockClear();
    cancelMock.mockClear();
    stubSpeechSynthesis();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('when disabled, speak/pause/resume/stop are no-ops', () => {
    const { result } = renderHook(() => useHarness({ enabled: false, voiceConfig: {} }));
    act(() => result.current.speak('hello'));
    expect(speakMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('speak() cancels any prior utterance then speaks a new SpeechSynthesisUtterance, setting status to playing', () => {
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: { rate: 1.2, volume: 0.7 } }));
    act(() => result.current.speak('Hello world'));

    expect(cancelMock).toHaveBeenCalledOnce();
    expect(speakMock).toHaveBeenCalledOnce();
    expect(lastUtterance?.text).toBe('Hello world');
    expect(lastUtterance?.rate).toBe(1.2);
    expect(lastUtterance?.volume).toBe(0.7);
    expect(result.current.status).toBe('playing');
  });

  it('speak() with empty text is a no-op', () => {
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {} }));
    act(() => result.current.speak(''));
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('onboundary events update spokenRange with the absolute char range', () => {
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {} }));
    act(() => result.current.speak('Hello world'));

    act(() => lastUtterance?.onboundary?.({ name: 'word', charIndex: 6, charLength: 5 }));
    expect(result.current.spokenRange).toEqual({ start: 6, end: 11 });
  });

  it('a non-"word" boundary event is ignored', () => {
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {} }));
    act(() => result.current.speak('Hello world'));
    act(() => lastUtterance?.onboundary?.({ name: 'sentence', charIndex: 0 }));
    expect(result.current.spokenRange).toBeNull();
  });

  it('onend transitions to done, clears spokenRange, and calls onFinished("done")', () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {}, onFinished }));
    act(() => result.current.speak('Hello world'));
    act(() => lastUtterance?.onboundary?.({ name: 'word', charIndex: 0, charLength: 5 }));

    act(() => lastUtterance?.onend?.());

    expect(result.current.status).toBe('done');
    expect(result.current.spokenRange).toBeNull();
    expect(onFinished).toHaveBeenCalledWith('done');
  });

  it('onerror with a real error transitions to error and calls onFinished("error")', () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {}, onFinished }));
    act(() => result.current.speak('Hello world'));

    act(() => lastUtterance?.onerror?.({ error: 'synthesis-failed' }));

    expect(result.current.status).toBe('error');
    expect(onFinished).toHaveBeenCalledWith('error');
  });

  it('onerror with "interrupted"/"canceled" is ignored (expected during cancel/restart, not a real failure)', () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {}, onFinished }));
    act(() => result.current.speak('Hello world'));

    act(() => lastUtterance?.onerror?.({ error: 'interrupted' }));

    expect(result.current.status).toBe('playing');
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('pause() cancels speech, remembers the last word-boundary offset, and sets status to paused', () => {
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {} }));
    act(() => result.current.speak('Hello brave new world'));
    act(() => lastUtterance?.onboundary?.({ name: 'word', charIndex: 6, charLength: 5 })); // "brave" at 6

    cancelMock.mockClear();
    act(() => result.current.pause());

    expect(cancelMock).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('paused');
  });

  it('resume() restarts a NEW utterance sliced from the paused offset', () => {
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {} }));
    act(() => result.current.speak('Hello brave new world'));
    act(() => lastUtterance?.onboundary?.({ name: 'word', charIndex: 6, charLength: 5 }));
    act(() => result.current.pause());

    speakMock.mockClear();
    act(() => result.current.resume());

    expect(speakMock).toHaveBeenCalledOnce();
    expect(lastUtterance?.text).toBe('brave new world');
  });

  it('pause() while not playing, and resume() while not paused, are no-ops', () => {
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {} }));
    act(() => result.current.pause());
    expect(cancelMock).not.toHaveBeenCalled();
    act(() => result.current.resume());
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('stop() cancels speech, resets to idle with no spokenRange, and calls onFinished("idle") to reset the player UI', () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {}, onFinished }));
    act(() => result.current.speak('Hello world'));
    cancelMock.mockClear();

    act(() => result.current.stop());

    expect(cancelMock).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('idle');
    expect(result.current.spokenRange).toBeNull();
    expect(onFinished).toHaveBeenCalledWith('idle');
  });

  it('speaking all-whitespace text resolves immediately to done without ever calling speechSynthesis.speak', () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useHarness({ enabled: true, voiceConfig: {}, onFinished }));
    act(() => result.current.speak('   '));
    expect(speakMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('done');
    expect(onFinished).toHaveBeenCalledWith('done');
  });
});
