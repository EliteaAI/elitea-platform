/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useStreamingSpeechRecognition.hooks.js` — the backend ASR path:
 * getUserMedia -> AudioContext -> AudioWorklet (an inline processor
 * registered from a Blob URL) -> Float32-to-PCM16 conversion -> emit over
 * the socket. Faithfully ports the AudioWorklet processor code (linear-
 * interpolation resampling, buffered chunking), the buffer-size selection
 * (`BUFFER_SIZE_WHISPER`=7200 vs `BUFFER_SIZE_REALTIME`=4800 samples, chosen
 * via `asrHelpers.isWhisperModel`), the `acceptEventsRef` session-fencing
 * flag (discards stale events from a just-ended/not-yet-started session),
 * and the exact emit/receive event payloads `shared/api/socket/events.ts`
 * (unit S5) already documents for `asr_*`.
 *
 * Socket access: reads the client via `useContext(SocketClientContext)`
 * (degrading to `null`), NOT the throwing `useSocketClient()` — same
 * posture as this cluster's own `useTextToSpeech.hooks.ts` and
 * `VoiceConfigDialog.tsx`: no `app/` file mounts a
 * `SocketClientContext.Provider` yet, and a missing socket is this hook's
 * legitimate "backend ASR unavailable" state (old-app parity:
 * `useStreamingSpeechRecognition.hooks.js`'s own `socket` came from
 * `useContext(SocketContext)`, which defaults to `null` with no provider,
 * and every usage there guards it — `if (!socket) return;` in the listener
 * effect, `socket?.emit(...)` for `asr_stop`), not a programmer error
 * `useSocketClient()`'s throw-if-absent contract would be correct for.
 * Every socket-dependent operation below (the listener effect, the
 * `asr_start`/`asr_stop` emits, the raw `socket.emit` chunk path) is a
 * no-op when `client` is `null`; `isSupported` stays gated on `!!asrModel`
 * only (this file's own return, unchanged), so a missing socket silently
 * disables backend ASR instead of crashing the component.
 *
 * `asr_audio_chunk` uses `client.socket.emit(...)` directly — the raw-socket
 * escape hatch `shared/api/socket/client.ts`'s own doc comment names this
 * EXACT use case ("e.g. binary ASR chunk emits"): every other chunk (dozens
 * per recording session) would otherwise re-run `client.emit()`'s per-call
 * zod `safeParse` for no validation benefit (`asrAudioChunkEmitSchema` only
 * asserts `audio` is present). `asr_start`/`asr_stop` are small, low-
 * frequency, structured payloads and go through the normal validated
 * `client.emit()`.
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { SocketClientContext } from '@/shared/api/socket/client';
import type { EmitPayloadOf, ReceivePayloadOf } from '@/shared/api/socket/events';

import { isWhisperModel } from '../helpers/asrHelpers';
import type { ModelListItem } from '../../api/models';
import type { TranscriptEvent } from './useSpeechRecognition';

// Buffer sizes at 24 kHz — trade-off between latency and API call frequency.
// Whisper is a batch API with rate limits, so larger chunks reduce request
// frequency. Realtime models stream continuously and benefit from lower
// latency.
// Not exported (knip: no outside consumer) — read only by this file's own
// `startRecording` below.
const BUFFER_SIZE_WHISPER = 7200; // 300 ms — reduce Whisper API call frequency
const BUFFER_SIZE_REALTIME = 4800; // 200 ms — lower latency for streaming models

// Target sample rate expected by both Whisper and the Realtime API.
const TARGET_SAMPLE_RATE = 24000;

export const AUDIO_CHUNK_PROCESSOR_NAME = 'audio-chunk-processor';

/**
 * AudioWorklet processor source — registered from a Blob URL and executed in
 * the AudioWorkletGlobalScope (a separate JS realm; it cannot `import` app
 * code, hence this being a plain string, byte-for-byte ported from the old
 * app). Not directly unit-testable in jsdom (no AudioWorklet runtime). The
 * resample math is mirrored by the pure, exported {@link resampleLinear}
 * below purely so it can be unit-tested directly — the two must be kept in
 * sync by hand if either ever changes; the worklet copy below is what
 * actually runs in production.
 */
// Not exported (knip: no outside consumer) — read only by this file's own
// `startRecording` below (the worklet blob source).
const AUDIO_CHUNK_PROCESSOR_CODE = `
class AudioChunkProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 4800;    // output samples at TARGET_SAMPLE_RATE
    this._inputRate = 44100;    // overridden via port message
    this._outputRate = 24000;   // overridden via port message
    this.port.onmessage = (e) => {
      if (e.data?.bufferSize)  this._bufferSize  = e.data.bufferSize;
      if (e.data?.inputRate)   this._inputRate   = e.data.inputRate;
      if (e.data?.outputRate)  this._outputRate  = e.data.outputRate;
    };
  }

  _resample(input) {
    if (this._inputRate === this._outputRate) return input;
    const ratio = this._inputRate / this._outputRate;
    const outLen = Math.round(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const lo = Math.floor(src);
      const hi = Math.min(lo + 1, input.length - 1);
      out[i] = input[lo] + (input[hi] - input[lo]) * (src - lo);
    }
    return out;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const resampled = this._resample(channel);
    for (let i = 0; i < resampled.length; i++) {
      this._buffer.push(resampled[i]);
    }

    while (this._buffer.length >= this._bufferSize) {
      const chunk = new Float32Array(this._buffer.splice(0, this._bufferSize));
      this.port.postMessage(chunk);
    }

    return true;
  }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor);
`;

/** Pure reference copy of {@link AUDIO_CHUNK_PROCESSOR_CODE}'s `_resample` — see that constant's doc comment. Not called by the hook itself (the real resampling happens inside the worklet); exported for direct unit testing only. */
export function resampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outLen = Math.round(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, input.length - 1);
    const loVal = input[lo] ?? 0;
    const hiVal = input[hi] ?? 0;
    out[i] = loVal + (hiVal - loVal) * (src - lo);
  }
  return out;
}

/** `useStreamingSpeechRecognition.hooks.js`'s `float32ToPcm16Buffer` — exported for direct unit testing. */
export function float32ToPcm16Buffer(float32Array: Float32Array): ArrayBuffer {
  const pcm = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const sample = float32Array[i] ?? 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm.buffer;
}

export interface UseStreamingSpeechRecognitionParams {
  readonly onTranscript?: (event: TranscriptEvent) => void;
  readonly onTranscriptDone?: () => void;
  readonly onSpeechStarted?: () => void;
  readonly onVadFlush?: () => void;
  readonly onError?: (error: string) => void;
  readonly projectId?: string | undefined;
  readonly asrModel?: ModelListItem | undefined;
}

export interface UseStreamingSpeechRecognitionResult {
  readonly isRecording: boolean;
  /** `!!asrModel` (old-app parity, `useStreamingSpeechRecognition.hooks.js`'s own return) — "supported" here means "a backend ASR model is configured", not a browser feature check. */
  readonly isSupported: boolean;
  readonly startRecording: () => Promise<void>;
  readonly stopRecording: () => void;
}

function errorNameOf(err: unknown): string | undefined {
  return err instanceof DOMException ? err.name : undefined;
}

/** Extracted from `startRecording`'s `catch` purely to keep that function under the §3.5 cyclomatic-complexity-12 budget — same 3-way `getUserMedia` failure mapping, no behavior change. */
function mapGetUserMediaError(err: unknown): 'not-allowed' | 'audio-capture' | 'network' {
  const name = errorNameOf(err);
  if (name === 'NotAllowedError') return 'not-allowed';
  if (name === 'NotFoundError') return 'audio-capture';
  return 'network';
}

export function useStreamingSpeechRecognition(
  params: UseStreamingSpeechRecognitionParams = {},
): UseStreamingSpeechRecognitionResult {
  const { onTranscript, onTranscriptDone, onSpeechStarted, onVadFlush, onError, projectId, asrModel } = params;
  // Nullable — see this file's module doc for why `useContext` (not the
  // throwing `useSocketClient()`) is used here.
  const client = useContext(SocketClientContext);
  const [isRecording, setIsRecording] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onTranscriptDoneRef = useRef(onTranscriptDone);
  const onSpeechStartedRef = useRef(onSpeechStarted);
  const onVadFlushRef = useRef(onVadFlush);
  const onErrorRef = useRef(onError);
  // Set to false at the start of each new recording session to discard stale
  // events that arrive from the previous session before the new one is ready.
  const acceptEventsRef = useRef(false);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onTranscriptDoneRef.current = onTranscriptDone;
  }, [onTranscriptDone]);

  useEffect(() => {
    onSpeechStartedRef.current = onSpeechStarted;
  }, [onSpeechStarted]);

  useEffect(() => {
    onVadFlushRef.current = onVadFlush;
  }, [onVadFlush]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Listen for transcription events from the backend. No-op when no socket
  // is available (see this file's module doc).
  useEffect(() => {
    if (!client) return undefined;

    const onDelta = (payload: ReceivePayloadOf<'asr_transcript_delta'>): void => {
      if (!acceptEventsRef.current) return;
      onTranscriptRef.current?.({ interim: payload.delta ?? '', final: '' });
    };

    const onDone = (payload: ReceivePayloadOf<'asr_transcript_done'>): void => {
      if (!acceptEventsRef.current) return;
      if (payload.transcript) onTranscriptRef.current?.({ interim: '', final: payload.transcript });
      // Always notify so the caller can decrement its pending-speech counter,
      // even when the transcript is empty (short audio, rate-limited, errors).
      onTranscriptDoneRef.current?.();
    };

    const onSpeechStart = (): void => {
      if (!acceptEventsRef.current) return;
      onSpeechStartedRef.current?.();
    };

    const onVadFlushEvent = (): void => {
      if (!acceptEventsRef.current) return;
      onVadFlushRef.current?.();
    };

    const onErr = (payload: ReceivePayloadOf<'asr_error'>): void => {
      onErrorRef.current?.(payload.error ?? '');
    };

    client.on('asr_transcript_delta', onDelta);
    client.on('asr_transcript_done', onDone);
    client.on('asr_speech_started', onSpeechStart);
    client.on('asr_vad_flush', onVadFlushEvent);
    client.on('asr_error', onErr);

    return () => {
      client.off('asr_transcript_delta', onDelta);
      client.off('asr_transcript_done', onDone);
      client.off('asr_speech_started', onSpeechStart);
      client.off('asr_vad_flush', onVadFlushEvent);
      client.off('asr_error', onErr);
    };
  }, [client]);

  const releaseAudio = useCallback(() => {
    // Null refs first so concurrent calls (stopRecording + unmount) don't double-close.
    const worklet = workletNodeRef.current;
    const ctx = audioContextRef.current;
    const stream = streamRef.current;
    workletNodeRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;

    worklet?.disconnect();
    if (ctx && ctx.state !== 'closed') void ctx.close();
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const startRecording = useCallback(async () => {
    // Discard any late events still arriving from the previous session.
    acceptEventsRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      // Use the browser's native sample rate to avoid cross-rate errors (e.g.
      // Firefox). The worklet resamples to TARGET_SAMPLE_RATE (24 kHz)
      // before sending chunks.
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Register the AudioWorklet processor via a Blob URL.
      const blob = new Blob([AUDIO_CHUNK_PROCESSOR_CODE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, AUDIO_CHUNK_PROCESSOR_NAME);
      workletNodeRef.current = workletNode;

      // Configure chunk size and sample rates before audio starts flowing.
      const bufferSize = isWhisperModel(asrModel?.name) ? BUFFER_SIZE_WHISPER : BUFFER_SIZE_REALTIME;
      workletNode.port.postMessage({
        bufferSize,
        inputRate: audioContext.sampleRate,
        outputRate: TARGET_SAMPLE_RATE,
      });

      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const pcm16Buffer = float32ToPcm16Buffer(event.data);
        const payload = { audio: pcm16Buffer } satisfies EmitPayloadOf<'asr_audio_chunk'>;
        // Raw-socket escape hatch — see this file's module doc. No-op when
        // no socket is available.
        client?.socket.emit('asr_audio_chunk', payload);
      };

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.7; // 1.0 = unity, >1.0 = boost, <1.0 = attenuate
      source.connect(gainNode);
      gainNode.connect(workletNode);
      workletNode.connect(audioContext.destination);

      // Start accepting transcript events for this session.
      acceptEventsRef.current = true;

      // Tell the backend to open the Realtime WS.
      const startPayload = {
        project_id: projectId,
        model_name: asrModel?.name,
        model_project_id: asrModel?.project_id,
        language: navigator.language?.split('-')[0] ?? 'en',
      } satisfies EmitPayloadOf<'asr_start'>;
      client?.emit('asr_start', startPayload);

      setIsRecording(true);
    } catch (err) {
      acceptEventsRef.current = false;
      onErrorRef.current?.(mapGetUserMediaError(err));
    }
  }, [client, projectId, asrModel]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;
    // Block events from this session before tearing down audio so late
    // backend messages (e.g. a final Realtime transcript still in-flight)
    // are discarded.
    acceptEventsRef.current = false;
    releaseAudio();
    client?.emit('asr_stop', {});
    setIsRecording(false);
  }, [isRecording, client, releaseAudio]);

  // Cleanup on unmount — only emit asr_stop if actually recording.
  useEffect(() => {
    return () => {
      if (!streamRef.current) return;
      acceptEventsRef.current = false;
      releaseAudio();
      client?.emit('asr_stop', {});
    };
  }, [client, releaseAudio]);

  return { isRecording, isSupported: !!asrModel, startRecording, stopRecording };
}
