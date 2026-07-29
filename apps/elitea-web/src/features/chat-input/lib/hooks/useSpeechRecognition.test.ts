/**
 * Web Speech API is not implemented by jsdom — this is a hand-rolled fake
 * `SpeechRecognition` constructor (no established Web-Speech mocking
 * pattern exists elsewhere in this codebase to follow; the closest
 * precedent, `features/notifications/lib/soundNotification.test.ts`'s
 * `window.AudioContext` fake-class + `@ts-expect-error` assignment style,
 * is mirrored here for the same "stub a missing jsdom global" need).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSpeechRecognition } from './useSpeechRecognition';

interface FakeResultAlternative {
  readonly transcript: string;
}

interface FakeResult extends Array<FakeResultAlternative> {
  isFinal: boolean;
}

class FakeSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: { resultIndex: number; results: FakeResult[] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  static instances: FakeSpeechRecognition[] = [];

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  emitResult(resultIndex: number, results: FakeResult[]): void {
    this.onresult?.({ resultIndex, results });
  }

  emitError(error: string): void {
    this.onerror?.({ error });
  }

  emitEnd(): void {
    this.onend?.();
  }
}

function makeResult(transcript: string, isFinal: boolean): FakeResult {
  const result = [{ transcript }] as FakeResult;
  result.isFinal = isFinal;
  return result;
}

type WindowWithSpeechRecognition = typeof window & {
  SpeechRecognition?: typeof FakeSpeechRecognition;
  webkitSpeechRecognition?: typeof FakeSpeechRecognition;
};

function installFakeSpeechRecognition(): void {
  FakeSpeechRecognition.instances = [];
  (window as WindowWithSpeechRecognition).SpeechRecognition = FakeSpeechRecognition;
}

function uninstallFakeSpeechRecognition(): void {
  delete (window as WindowWithSpeechRecognition).SpeechRecognition;
  delete (window as WindowWithSpeechRecognition).webkitSpeechRecognition;
}

afterEach(() => {
  uninstallFakeSpeechRecognition();
});

describe('useSpeechRecognition', () => {
  it('reports isSupported=false when neither constructor exists on window', async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(result.current.isSupported).toBe(false));
  });

  it('reports isSupported=true once window.SpeechRecognition is present', async () => {
    installFakeSpeechRecognition();
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
  });

  it('falls back to webkitSpeechRecognition when SpeechRecognition is absent', async () => {
    (window as WindowWithSpeechRecognition).webkitSpeechRecognition = FakeSpeechRecognition;
    const { result } = renderHook(() => useSpeechRecognition());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
  });

  it('startRecording constructs a recognizer, sets continuous/interimResults, and flips isRecording', () => {
    installFakeSpeechRecognition();
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => result.current.startRecording());

    expect(result.current.isRecording).toBe(true);
    const instance = FakeSpeechRecognition.instances[0];
    expect(instance).toBeDefined();
    expect(instance?.continuous).toBe(true);
    expect(instance?.interimResults).toBe(true);
    expect(instance?.start).toHaveBeenCalledOnce();
  });

  it('is a no-op when no constructor is available', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.startRecording());
    expect(result.current.isRecording).toBe(false);
  });

  it('aborts an in-flight session before starting a new one', () => {
    installFakeSpeechRecognition();
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => result.current.startRecording());
    const first = FakeSpeechRecognition.instances[0];
    act(() => result.current.startRecording());

    expect(first?.abort).toHaveBeenCalledOnce();
    expect(FakeSpeechRecognition.instances).toHaveLength(2);
  });

  it('forwards final/interim transcript segments split by isFinal', () => {
    installFakeSpeechRecognition();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }));

    act(() => result.current.startRecording());
    const instance = FakeSpeechRecognition.instances[0];
    act(() =>
      instance?.emitResult(0, [makeResult('hello ', false), makeResult('world', true)]),
    );

    expect(onTranscript).toHaveBeenCalledWith({ final: 'world', interim: 'hello ' });
  });

  it('always calls the LATEST onTranscript without re-registering the recognizer', () => {
    installFakeSpeechRecognition();
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ onTranscript }) => useSpeechRecognition({ onTranscript }), {
      initialProps: { onTranscript: first },
    });
    act(() => result.current.startRecording());
    rerender({ onTranscript: second });

    const instance = FakeSpeechRecognition.instances[0];
    act(() => instance?.emitResult(0, [makeResult('hi', true)]));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ final: 'hi', interim: '' });
  });

  it('swallows an "aborted" error (triggered by stopRecording) without calling onError', () => {
    installFakeSpeechRecognition();
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onError }));
    act(() => result.current.startRecording());

    const instance = FakeSpeechRecognition.instances[0];
    act(() => instance?.emitError('aborted'));

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
  });

  it('forwards a non-aborted error to onError and stops recording', () => {
    installFakeSpeechRecognition();
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onError }));
    act(() => result.current.startRecording());

    const instance = FakeSpeechRecognition.instances[0];
    act(() => instance?.emitError('network'));

    expect(onError).toHaveBeenCalledWith('network');
    expect(result.current.isRecording).toBe(false);
  });

  it('onend stops recording (e.g. the browser ends the session on its own)', () => {
    installFakeSpeechRecognition();
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.startRecording());

    const instance = FakeSpeechRecognition.instances[0];
    act(() => instance?.emitEnd());

    expect(result.current.isRecording).toBe(false);
  });

  it('stopRecording calls .stop() on the active recognizer and clears isRecording', () => {
    installFakeSpeechRecognition();
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.startRecording());
    const instance = FakeSpeechRecognition.instances[0];

    act(() => result.current.stopRecording());

    expect(instance?.stop).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(false);
  });

  it('stopRecording is a no-op when nothing is recording', () => {
    installFakeSpeechRecognition();
    const { result } = renderHook(() => useSpeechRecognition());
    expect(() => act(() => result.current.stopRecording())).not.toThrow();
    expect(result.current.isRecording).toBe(false);
  });

  it('aborts the active recognizer on unmount', () => {
    installFakeSpeechRecognition();
    const { result, unmount } = renderHook(() => useSpeechRecognition());
    act(() => result.current.startRecording());
    const instance = FakeSpeechRecognition.instances[0];

    unmount();

    expect(instance?.abort).toHaveBeenCalledOnce();
  });
});
