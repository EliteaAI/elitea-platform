/**
 * useStreamingSpeechRecognition.test.ts
 *
 * Socket: uses `createSocketClient` + an injected `ioFactory` (mirroring
 * `shared/api/socket/client.test.ts`'s own `createFakeSocket()`/
 * `makeClient()` helpers), NOT `shared/api/socket/testing.ts`'s
 * `TestSocketClient` — that double's `.socket` is a non-functional stub
 * (`socket: fakeSocket` with no working `.emit`, by its own doc comment:
 * "prefer emit/on"), which cannot exercise this hook's raw-socket
 * `client.socket.emit('asr_audio_chunk', ...)` escape hatch. Using the real
 * `createSocketClient` factory with a hand-rolled fake `Socket` (exact same
 * technique `client.test.ts` already uses to prove `client.ts`'s own wiring)
 * gives a `.socket` that is the actual injected fake, so both the validated
 * `client.emit()` path AND the raw `client.socket.emit()` path are
 * observable from the same double.
 *
 * Web Audio API: jsdom implements neither `AudioContext`/`AudioWorkletNode`
 * nor `navigator.mediaDevices.getUserMedia` — no established mocking
 * pattern for this exists elsewhere in the codebase yet (grepped: the only
 * prior Web-Audio-adjacent test, `features/notifications/lib/
 * soundNotification.test.ts`, only stubs `window.AudioContext` for a
 * `createOscillator`/`createGain` tone, never `AudioWorkletNode`/
 * `getUserMedia`). The fakes below are hand-rolled for this file, following
 * that prior test's `@ts-expect-error` + fake-class assignment style where
 * the shapes line up.
 */
import { createElement, type ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SocketClientContext, createSocketClient } from '@/shared/api/socket/client';
import type { SocketIoFactory } from '@/shared/api/socket/client';
import type { ModelListItem } from '../../api/models';

import {
  AUDIO_CHUNK_PROCESSOR_NAME,
  float32ToPcm16Buffer,
  resampleLinear,
  useStreamingSpeechRecognition,
} from './useStreamingSpeechRecognition';

/* ── socket double (client.test.ts's own technique — see file doc) ────────── */

function createFakeSocket() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const managerListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emittedCalls: Array<{ event: string; payload: unknown }> = [];

  function add(map: Map<string, Set<(...args: unknown[]) => void>>, event: string, handler: (...args: unknown[]) => void) {
    let set = map.get(event);
    if (!set) {
      set = new Set();
      map.set(event, set);
    }
    set.add(handler);
  }

  const fake = {
    on: (event: string, handler: (...args: unknown[]) => void) => add(listeners, event, handler),
    off: (event: string, handler: (...args: unknown[]) => void) => listeners.get(event)?.delete(handler),
    emit: (event: string, payload: unknown) => {
      emittedCalls.push({ event, payload });
      return fake;
    },
    disconnect: vi.fn(),
    io: { on: (event: string, handler: (...args: unknown[]) => void) => add(managerListeners, event, handler), off: vi.fn() },
    trigger(event: string, ...args: unknown[]) {
      for (const h of listeners.get(event) ?? []) h(...args);
    },
    emittedCalls,
  };
  return fake;
}

function makeClient() {
  const fakeSocket = createFakeSocket();
  // `ReturnType<SocketIoFactory>`, not a direct `import type { Socket } from
  // 'socket.io-client'` — R-A3's `no-restricted-imports` bans importing
  // that package by name outside `shared/api/socket/**`.
  const ioFactory = vi.fn(() => fakeSocket as unknown as ReturnType<SocketIoFactory>) as unknown as SocketIoFactory;
  const client = createSocketClient({ url: 'http://socket.test', ioFactory });
  return { client, fakeSocket };
}

function withClient(client: ReturnType<typeof createSocketClient>) {
  return ({ children }: { children: ReactNode }) => createElement(SocketClientContext.Provider, { value: client }, children);
}

/* ── Web Audio / getUserMedia fakes ────────────────────────────────────────── */

class FakeAudioParam {
  value = 0;
}
class FakeGainNode {
  gain = new FakeAudioParam();
  connect = vi.fn();
}
class FakeSourceNode {
  connect = vi.fn();
}
class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  port: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((e: MessageEvent<Float32Array>) => void) | null } = {
    postMessage: vi.fn(),
    onmessage: null,
  };
  connect = vi.fn();
  disconnect = vi.fn();
  contextRef: unknown;
  name: string;

  constructor(context: unknown, name: string) {
    this.contextRef = context;
    this.name = name;
    FakeAudioWorkletNode.instances.push(this);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  sampleRate = 44100;
  state: 'running' | 'closed' = 'running';
  destination = {};
  audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
  createMediaStreamSource = vi.fn(() => new FakeSourceNode());
  createGain = vi.fn(() => new FakeGainNode());

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

interface FakeMediaStreamTrack {
  stop: ReturnType<typeof vi.fn>;
}

function makeFakeMediaStream(): MediaStream {
  const track: FakeMediaStreamTrack = { stop: vi.fn() };
  return { getTracks: () => [track] } as unknown as MediaStream;
}

let getUserMediaMock: ReturnType<typeof vi.fn>;

function installWebAudioFakes(): void {
  FakeAudioWorkletNode.instances = [];
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  // Extends the REAL URL constructor (not a plain object spread of it — that
  // silently strips constructibility and broke `shared/api/http.ts`'s own
  // `new URL(...)` call with 'URL is not a constructor', the hard way) purely
  // to add the two static methods Node/jsdom's URL doesn't implement.
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = vi.fn(() => 'blob:fake');
      static override revokeObjectURL = vi.fn();
    },
  );
  getUserMediaMock = vi.fn(() => Promise.resolve(makeFakeMediaStream()));
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: getUserMediaMock },
    configurable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const REALTIME_MODEL: ModelListItem = { id: '1_gpt-realtime', name: 'gpt-4o-realtime', project_id: 1 };
const WHISPER_MODEL: ModelListItem = { id: '1_whisper-1', name: 'whisper-1', project_id: 1 };

describe('resampleLinear (pure reference copy of the worklet processor code)', () => {
  it('returns the input unchanged when rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleLinear(input, 24000, 24000)).toBe(input);
  });

  it('downsamples to the expected output length', () => {
    const input = new Float32Array(100);
    const output = resampleLinear(input, 48000, 24000);
    expect(output.length).toBe(50);
  });

  it('linearly interpolates between adjacent samples', () => {
    const input = new Float32Array([0, 10]);
    // ratio 2:1 collapses 2 samples to 1 — output[0] samples at src=0 exactly.
    const output = resampleLinear(input, 2, 1);
    expect(output[0]).toBeCloseTo(0, 5);
  });
});

describe('float32ToPcm16Buffer', () => {
  it('converts a Float32Array to a 16-bit PCM ArrayBuffer of the same length', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buffer = float32ToPcm16Buffer(input);
    expect(buffer.byteLength).toBe(input.length * 2);
    const view = new Int16Array(buffer);
    expect(view[0]).toBe(0);
    expect(view[3]).toBe(0x7fff);
    expect(view[4]).toBe(-0x8000);
  });

  it('clamps out-of-range samples to [-1, 1] before scaling', () => {
    const input = new Float32Array([2, -2]);
    const view = new Int16Array(float32ToPcm16Buffer(input));
    expect(view[0]).toBe(0x7fff);
    expect(view[1]).toBe(-0x8000);
  });
});

describe('useStreamingSpeechRecognition', () => {
  beforeEach(() => {
    installWebAudioFakes();
  });

  it('isSupported reflects !!asrModel, not a browser feature check', () => {
    const { client } = makeClient();
    const { result, rerender } = renderHook(({ asrModel }) => useStreamingSpeechRecognition({ asrModel }), {
      wrapper: withClient(client),
      initialProps: { asrModel: undefined as ModelListItem | undefined },
    });
    expect(result.current.isSupported).toBe(false);
    rerender({ asrModel: REALTIME_MODEL });
    expect(result.current.isSupported).toBe(true);
  });

  it('startRecording requests audio with the expected constraints and flips isRecording', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, projectId: 'p1' }), {
      wrapper: withClient(client),
    });

    await act(async () => {
      await result.current.startRecording();
    });

    expect(getUserMediaMock).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    expect(result.current.isRecording).toBe(true);
  });

  it('registers the AudioWorklet processor under AUDIO_CHUNK_PROCESSOR_NAME and wires gain -> worklet -> destination', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL }), {
      wrapper: withClient(client),
    });

    await act(async () => {
      await result.current.startRecording();
    });

    const ctx = FakeAudioContext.instances[0];
    expect(ctx?.audioWorklet.addModule).toHaveBeenCalledWith('blob:fake');
    const worklet = FakeAudioWorkletNode.instances[0];
    expect(worklet?.name).toBe(AUDIO_CHUNK_PROCESSOR_NAME);
    expect(worklet?.connect).toHaveBeenCalledWith(ctx?.destination);
  });

  it('selects BUFFER_SIZE_REALTIME for a non-whisper model', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL }), {
      wrapper: withClient(client),
    });
    await act(async () => {
      await result.current.startRecording();
    });
    const worklet = FakeAudioWorkletNode.instances[0];
    expect(worklet?.port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ bufferSize: 4800, outputRate: 24000 }),
    );
  });

  it('selects BUFFER_SIZE_WHISPER for a whisper model', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: WHISPER_MODEL }), {
      wrapper: withClient(client),
    });
    await act(async () => {
      await result.current.startRecording();
    });
    const worklet = FakeAudioWorkletNode.instances[0];
    expect(worklet?.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ bufferSize: 7200 }));
  });

  it('emits asr_start via the validated client.emit() with project_id/model_name/model_project_id/language', async () => {
    const { client, fakeSocket } = makeClient();
    const { result } = renderHook(
      () => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, projectId: 'proj-9' }),
      { wrapper: withClient(client) },
    );
    await act(async () => {
      await result.current.startRecording();
    });

    const asrStart = fakeSocket.emittedCalls.find((c) => c.event === 'asr_start');
    expect(asrStart?.payload).toMatchObject({
      project_id: 'proj-9',
      model_name: 'gpt-4o-realtime',
      model_project_id: 1,
    });
  });

  it('emits binary asr_audio_chunk via the RAW client.socket.emit escape hatch when the worklet posts a chunk', async () => {
    const { client, fakeSocket } = makeClient();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL }), {
      wrapper: withClient(client),
    });
    await act(async () => {
      await result.current.startRecording();
    });

    const worklet = FakeAudioWorkletNode.instances[0];
    const chunk = new Float32Array([0.1, -0.2, 0.3]);
    act(() => {
      worklet?.port.onmessage?.({ data: chunk } as MessageEvent<Float32Array>);
    });

    const chunkEmit = fakeSocket.emittedCalls.find((c) => c.event === 'asr_audio_chunk');
    expect(chunkEmit).toBeDefined();
    const payload = chunkEmit?.payload as { audio: ArrayBuffer };
    expect(payload.audio).toBeInstanceOf(ArrayBuffer);
    expect(payload.audio.byteLength).toBe(chunk.length * 2);
  });

  it('stopRecording releases audio, emits asr_stop, and clears isRecording', async () => {
    const { client, fakeSocket } = makeClient();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL }), {
      wrapper: withClient(client),
    });
    await act(async () => {
      await result.current.startRecording();
    });
    const worklet = FakeAudioWorkletNode.instances[0];
    const ctx = FakeAudioContext.instances[0];

    act(() => result.current.stopRecording());

    expect(worklet?.disconnect).toHaveBeenCalledOnce();
    expect(ctx?.close).toHaveBeenCalledOnce();
    expect(fakeSocket.emittedCalls.some((c) => c.event === 'asr_stop')).toBe(true);
    expect(result.current.isRecording).toBe(false);
  });

  it('stopRecording is a no-op when not recording', () => {
    const { client, fakeSocket } = makeClient();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL }), {
      wrapper: withClient(client),
    });
    act(() => result.current.stopRecording());
    expect(fakeSocket.emittedCalls).toHaveLength(0);
  });

  it('discards transcript events that arrive before acceptEventsRef is set (session fencing)', () => {
    const { client, fakeSocket } = makeClient();
    const onTranscript = vi.fn();
    renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onTranscript }), {
      wrapper: withClient(client),
    });

    // Not recording yet — acceptEventsRef is false — a late event from a
    // previous session must be discarded.
    act(() => fakeSocket.trigger('asr_transcript_delta', { delta: 'stale' }));
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('forwards asr_transcript_delta as an interim TranscriptEvent once accepting events', async () => {
    const { client, fakeSocket } = makeClient();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onTranscript }), {
      wrapper: withClient(client),
    });
    await act(async () => {
      await result.current.startRecording();
    });

    act(() => fakeSocket.trigger('asr_transcript_delta', { delta: 'hel' }));

    expect(onTranscript).toHaveBeenCalledWith({ interim: 'hel', final: '' });
  });

  it('forwards asr_transcript_done as a final TranscriptEvent AND calls onTranscriptDone', async () => {
    const { client, fakeSocket } = makeClient();
    const onTranscript = vi.fn();
    const onTranscriptDone = vi.fn();
    const { result } = renderHook(
      () => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onTranscript, onTranscriptDone }),
      { wrapper: withClient(client) },
    );
    await act(async () => {
      await result.current.startRecording();
    });

    act(() => fakeSocket.trigger('asr_transcript_done', { transcript: 'hello world' }));

    expect(onTranscript).toHaveBeenCalledWith({ interim: '', final: 'hello world' });
    expect(onTranscriptDone).toHaveBeenCalledOnce();
  });

  it('calls onTranscriptDone even when the transcript is empty', async () => {
    const { client, fakeSocket } = makeClient();
    const onTranscript = vi.fn();
    const onTranscriptDone = vi.fn();
    const { result } = renderHook(
      () => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onTranscript, onTranscriptDone }),
      { wrapper: withClient(client) },
    );
    await act(async () => {
      await result.current.startRecording();
    });

    act(() => fakeSocket.trigger('asr_transcript_done', {}));

    expect(onTranscript).not.toHaveBeenCalled();
    expect(onTranscriptDone).toHaveBeenCalledOnce();
  });

  it('forwards asr_speech_started and asr_vad_flush while accepting events', async () => {
    const { client, fakeSocket } = makeClient();
    const onSpeechStarted = vi.fn();
    const onVadFlush = vi.fn();
    const { result } = renderHook(
      () => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onSpeechStarted, onVadFlush }),
      { wrapper: withClient(client) },
    );
    await act(async () => {
      await result.current.startRecording();
    });

    act(() => fakeSocket.trigger('asr_speech_started', {}));
    act(() => fakeSocket.trigger('asr_vad_flush', {}));

    expect(onSpeechStarted).toHaveBeenCalledOnce();
    expect(onVadFlush).toHaveBeenCalledOnce();
  });

  it('forwards asr_error to onError REGARDLESS of the accept-events fence', () => {
    const { client, fakeSocket } = makeClient();
    const onError = vi.fn();
    renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onError }), {
      wrapper: withClient(client),
    });

    act(() => fakeSocket.trigger('asr_error', { error: 'boom' }));

    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('always calls the LATEST onTranscript without re-subscribing', async () => {
    const { client, fakeSocket } = makeClient();
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onTranscript }) => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onTranscript }),
      { wrapper: withClient(client), initialProps: { onTranscript: first } },
    );
    await act(async () => {
      await result.current.startRecording();
    });
    rerender({ onTranscript: second });

    act(() => fakeSocket.trigger('asr_transcript_delta', { delta: 'x' }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ interim: 'x', final: '' });
  });

  it('maps a getUserMedia NotAllowedError to onError("not-allowed")', async () => {
    getUserMediaMock.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { client } = makeClient();
    const onError = vi.fn();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onError }), {
      wrapper: withClient(client),
    });

    await act(async () => {
      await result.current.startRecording();
    });

    expect(onError).toHaveBeenCalledWith('not-allowed');
    expect(result.current.isRecording).toBe(false);
  });

  it('maps a getUserMedia NotFoundError to onError("audio-capture")', async () => {
    getUserMediaMock.mockRejectedValueOnce(new DOMException('no mic', 'NotFoundError'));
    const { client } = makeClient();
    const onError = vi.fn();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onError }), {
      wrapper: withClient(client),
    });

    await act(async () => {
      await result.current.startRecording();
    });

    expect(onError).toHaveBeenCalledWith('audio-capture');
  });

  it('maps any other failure to onError("network")', async () => {
    getUserMediaMock.mockRejectedValueOnce(new Error('boom'));
    const { client } = makeClient();
    const onError = vi.fn();
    const { result } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL, onError }), {
      wrapper: withClient(client),
    });

    await act(async () => {
      await result.current.startRecording();
    });

    expect(onError).toHaveBeenCalledWith('network');
  });

  it('unmount cleanup emits asr_stop only if a session was actually active', () => {
    const { client, fakeSocket } = makeClient();
    const { unmount } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL }), {
      wrapper: withClient(client),
    });

    unmount();

    expect(fakeSocket.emittedCalls.some((c) => c.event === 'asr_stop')).toBe(false);
  });

  it('unmount cleanup releases audio and emits asr_stop when a session WAS active', async () => {
    const { client, fakeSocket } = makeClient();
    const { result, unmount } = renderHook(() => useStreamingSpeechRecognition({ asrModel: REALTIME_MODEL }), {
      wrapper: withClient(client),
    });
    await act(async () => {
      await result.current.startRecording();
    });
    const worklet = FakeAudioWorkletNode.instances[0];

    unmount();

    expect(worklet?.disconnect).toHaveBeenCalledOnce();
    expect(fakeSocket.emittedCalls.some((c) => c.event === 'asr_stop')).toBe(true);
  });
});
