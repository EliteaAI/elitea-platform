/**
 * The server-side model TTS backend (Socket.IO + Web Audio) — ported from
 * `useTextToSpeech.hooks.js`'s `hasModelTTS` branch (lines 98-644). Split
 * across `.types.ts` (the shared refs bag), `.scheduler.ts` (AudioContext +
 * buffered PCM queue), `.socket.ts` (`tts_audio_chunk`/`tts_done`/
 * `tts_error` handlers), and `.raf.ts` (highlight-loop math) — this file
 * wires those pieces into React effects/callbacks and stays a thin
 * dispatcher, per those files' own module docs (§3.5 budgets).
 *
 * State ownership split from the baseline (deliberate, not a behavioral
 * change): the baseline's `useTextToSpeech` owns `status`/`spokenRange`
 * directly as component state; here the OUTER `useTextToSpeech.hooks.ts`
 * owns that state (shared with the browser engine, only one of which is
 * ever active) and this engine receives the current `status` PLUS a
 * `setStatus` setter — same as the baseline's own `pause`/`resume`
 * `useCallback(..., [status, hasModelTTS])` dependency, just sourced from a
 * parent instead of local component state.
 */
import { useCallback, useEffect, useRef } from 'react';

import type { SocketClient } from '@/shared/api/socket/client';
import type { EmitPayloadOf } from '@/shared/api/socket/events';

import { buildCharTimeline } from '../helpers/ttsTimeline.helpers';

import { cancelScheduledFrame, computeModelTickOutcome } from './useModelTtsEngine.raf';
import { ensureAudioContext, scheduleFromQueue, stopModelAudio } from './useModelTtsEngine.scheduler';
import { buildChunkHandler, buildDoneHandler, buildErrorHandler } from './useModelTtsEngine.socket';
import type { ModelTtsRefs } from './useModelTtsEngine.types';
import type { TtsEngineHandle, TtsModel, TtsSpokenRange, TtsStatus, TtsVoiceConfig } from './useTextToSpeech.types';

/**
 * Every `ModelTtsRefs` member, in one `useRef`-per-field factory. Each
 * individual `useRef()` call is unconditional (rules-of-hooks-safe) and
 * already returns a stable object across renders; wrapping the whole BAG in
 * its own outer `useRef` (built exactly once, on the first render) gives
 * the returned `ModelTtsRefs` object itself a stable identity too, so
 * `refs` is safe to list in a `useCallback`/`useEffect` dependency array
 * without defeating memoization.
 */
function useModelTtsRefs(): ModelTtsRefs {
  const audioContext = useRef<AudioContext | null>(null);
  const masterGain = useRef<GainNode | null>(null);
  const nextStartTime = useRef(0);
  const scheduledSources = useRef<AudioBufferSourceNode[]>([]);
  const playStartTime = useRef<number | null>(null);
  const totalDuration = useRef(0);
  const allChunksReceived = useRef(false);
  const userPaused = useRef(false);
  const calibratedRate = useRef(15.4);
  const charTimeline: ModelTtsRefs['charTimeline'] = useRef(null);
  const sentenceWaypoints: ModelTtsRefs['sentenceWaypoints'] = useRef([]);
  const pendingChunk: ModelTtsRefs['pendingChunk'] = useRef(null);
  const newSentence = useRef(true);
  const pcmQueue: ModelTtsRefs['pcmQueue'] = useRef([]);
  const schedulerTimer: ModelTtsRefs['schedulerTimer'] = useRef(null);
  const finalTtsDone = useRef(false);
  const totalEnqueuedSamples = useRef(0);
  const sampleRate = useRef(24000);
  const fullText = useRef('');
  const raf = useRef<number | null>(null);

  const bagRef = useRef<ModelTtsRefs | null>(null);
  bagRef.current ??= {
    audioContext,
    masterGain,
    nextStartTime,
    scheduledSources,
    playStartTime,
    totalDuration,
    allChunksReceived,
    userPaused,
    calibratedRate,
    charTimeline,
    sentenceWaypoints,
    pendingChunk,
    newSentence,
    pcmQueue,
    schedulerTimer,
    finalTtsDone,
    totalEnqueuedSamples,
    sampleRate,
    fullText,
    raf,
  };
  return bagRef.current;
}

export interface UseModelTtsEngineParams {
  /** `hasModelTTS` — `false` keeps every effect below a no-op (this engine idle while the browser engine is active). */
  readonly enabled: boolean;
  /** The outer hook's current status — this engine only ever transitions it away from `playing`/`paused` states it itself set. */
  readonly status: TtsStatus;
  readonly ttsModel: TtsModel | null | undefined;
  readonly socket: SocketClient | null | undefined;
  readonly voiceConfig: TtsVoiceConfig | undefined;
  readonly setStatus: (status: TtsStatus) => void;
  readonly setSpokenRange: (range: TtsSpokenRange | null) => void;
  /** Called when playback reaches `done` (RAF loop), `error` (`tts_error`), or is explicitly `stop()`-ed (`'idle'`) — the outer hook resets `showPlayer`/`speakableText` here in every case, matching baseline's unconditional `resetStatus(newStatus)`. */
  readonly onFinished: (status: 'done' | 'error' | 'idle') => void;
}

export function useModelTtsEngine(params: UseModelTtsEngineParams): TtsEngineHandle {
  const { enabled, status, ttsModel, socket, voiceConfig, setStatus, setSpokenRange, onFinished } = params;
  const refs = useModelTtsRefs();

  // Live volume change — ramp to avoid a click artifact when the volume slider moves mid-playback.
  useEffect(() => {
    const ctx = refs.audioContext.current;
    if (!ctx || ctx.state === 'closed' || !refs.masterGain.current) return;
    refs.masterGain.current.gain.linearRampToValueAtTime(voiceConfig?.volume ?? 1.0, ctx.currentTime + 0.05);
    // Re-runs only when volume itself changes — `refs`/`ctx` are read fresh each time, not tracked as deps (mirrors the baseline's own `[voiceConfig?.volume]`-only effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceConfig?.volume]);

  useEffect(() => {
    if (!enabled || !socket) return undefined;
    const handleChunk = buildChunkHandler(refs);
    const handleDone = buildDoneHandler(refs);
    const handleError = buildErrorHandler(() => {
      stopModelAudio(refs);
      setStatus('error');
      setSpokenRange(null);
      onFinished('error');
    });

    socket.on('tts_audio_chunk', handleChunk);
    socket.on('tts_done', handleDone);
    socket.on('tts_error', handleError);
    return () => {
      socket.off('tts_audio_chunk', handleChunk);
      socket.off('tts_done', handleDone);
      socket.off('tts_error', handleError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, socket]);

  useEffect(() => {
    if (!enabled || status !== 'playing') return undefined;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      const outcome = computeModelTickOutcome(refs);
      if (outcome.kind === 'closed') {
        refs.raf.current = null;
        return;
      }
      if (outcome.kind === 'done') {
        setStatus('done');
        setSpokenRange(null);
        stopModelAudio(refs);
        onFinished('done');
        refs.raf.current = null;
        return;
      }
      if (outcome.kind === 'progress' && outcome.spokenRange) setSpokenRange(outcome.spokenRange);
      refs.raf.current = requestAnimationFrame(tick);
    };
    refs.raf.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelScheduledFrame(refs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, status]);

  const speak = useCallback(
    (text: string) => {
      if (!enabled || !text || !ttsModel || !socket) return;

      refs.userPaused.current = false;
      socket.emit('tts_stop', {});
      stopModelAudio(refs);
      refs.sentenceWaypoints.current = [];
      refs.fullText.current = text;
      refs.charTimeline.current = buildCharTimeline(text, refs.calibratedRate.current);
      refs.pcmQueue.current = [];
      refs.finalTtsDone.current = false;
      refs.totalEnqueuedSamples.current = 0;

      ensureAudioContext(refs, voiceConfig?.volume ?? 1.0, 24000);
      if (refs.schedulerTimer.current !== null) clearInterval(refs.schedulerTimer.current);
      refs.schedulerTimer.current = setInterval(() => scheduleFromQueue(refs), 25);

      const payload = {
        project_id: ttsModel.project_id,
        model_name: ttsModel.name,
        model_project_id: ttsModel.project_id,
        text,
        voice: voiceConfig?.voiceId || undefined,
        speed: voiceConfig?.rate ?? 1.0,
      } satisfies EmitPayloadOf<'tts_start'>;
      socket.emit('tts_start', payload);

      setStatus('playing');
      setSpokenRange(null);
    },
    [enabled, ttsModel, socket, voiceConfig, setStatus, setSpokenRange, refs],
  );

  const pause = useCallback(() => {
    if (!enabled || status !== 'playing') return;
    refs.userPaused.current = true;
    void refs.audioContext.current?.suspend();
    setStatus('paused');
  }, [enabled, status, setStatus, refs]);

  const resume = useCallback(() => {
    if (!enabled || status !== 'paused') return;
    refs.userPaused.current = false;
    void refs.audioContext.current?.resume();
    setStatus('playing');
  }, [enabled, status, setStatus, refs]);

  const stop = useCallback(() => {
    if (!enabled) return;
    refs.userPaused.current = false;
    socket?.emit('tts_stop', {});
    stopModelAudio(refs);
    refs.fullText.current = '';
    setStatus('idle');
    setSpokenRange(null);
    onFinished('idle');
  }, [enabled, socket, setStatus, setSpokenRange, refs, onFinished]);

  // Cleanup on unmount (or `enabled` flipping off mid-playback).
  useEffect(() => {
    return () => {
      if (enabled) stopModelAudio(refs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { speak, pause, resume, stop };
}
