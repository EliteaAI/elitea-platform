/**
 * The browser `SpeechSynthesis` fallback TTS backend — ported from
 * `useTextToSpeech.hooks.js`'s non-`hasModelTTS` branch (`startUtterance`
 * lines 373-432, `speak`/`pause`/`resume`/`stop`'s
 * `isSpeechSynthesisSupported` cases, and the RAF fallback loop lines
 * 783-837).
 *
 * Pause/resume is SIMULATED by cancelling and restarting from the last
 * word-boundary position — Chrome does not honour
 * `speechSynthesis.pause()`, so the baseline never relies on it either.
 *
 * Word highlight: Safari/Firefox fire `onboundary` reliably; the moment the
 * first boundary event fires for an utterance, the RAF estimation loop
 * exits PERMANENTLY for that utterance (`lastBoundaryTimeRef` becomes
 * non-null) so the two mechanisms never fight over `setSpokenRange` — same
 * as the baseline.
 *
 * State-ownership split from the baseline: same as
 * `useModelTtsEngine.hooks.ts`'s own doc comment — `status`/`spokenRange`
 * are owned by the outer `useTextToSpeech.hooks.ts`, passed down as
 * `status`/`setStatus`/`setSpokenRange` instead of local component state.
 * `calibratedRateRef` is a separate ref from the model engine's own (the
 * baseline shares ONE `calibratedRateRef` across both backends) — see this
 * unit's final report for why splitting it is a disclosed, low-risk
 * deviation.
 */
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { wordRangeAround } from '../helpers/ttsHighlight.helpers';
import { buildCharTimeline, type CharTimeline } from '../helpers/ttsTimeline.helpers';

import { estimateBrowserRelativePos } from './useBrowserTtsEngine.raf';
import type { TtsEngineHandle, TtsSpokenRange, TtsStatus, TtsVoiceConfig } from './useTextToSpeech.types';

function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Cancels whatever frame is currently scheduled, if any — a standalone
 * function (not inlined in the RAF effect's cleanup) so the cleanup body
 * calls this instead of reading `rafRef.current` as a direct member access,
 * same rationale as `useModelTtsEngine.raf.ts`'s `cancelScheduledFrame`.
 */
function cancelScheduledFrame(rafRef: RefObject<number | null>): void {
  if (rafRef.current !== null) {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
}

export interface UseBrowserTtsEngineParams {
  /** `!hasModelTTS` — `false` keeps every effect below a no-op (this engine idle while the model engine is active). */
  readonly enabled: boolean;
  readonly status: TtsStatus;
  readonly voiceConfig: TtsVoiceConfig | undefined;
  readonly setStatus: (status: TtsStatus) => void;
  readonly setSpokenRange: (range: TtsSpokenRange | null) => void;
  /** Called when playback reaches `done`/`error`, or is explicitly `stop()`-ed (`'idle'`) — the outer hook resets `showPlayer`/`speakableText` here in every case, matching baseline's unconditional `resetStatus(newStatus)`. */
  readonly onFinished: (status: 'done' | 'error' | 'idle') => void;
}

export function useBrowserTtsEngine(params: UseBrowserTtsEngineParams): TtsEngineHandle {
  const { enabled, status, voiceConfig, setStatus, setSpokenRange, onFinished } = params;

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const fullTextRef = useRef('');
  const startOffsetRef = useRef(0);
  const lastBoundaryRef = useRef(0);
  const pausedOffsetRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const lastBoundaryTimeRef = useRef<number | null>(null);
  const charTimelineRef = useRef<CharTimeline | null>(null);
  const calibratedRateRef = useRef(15.4);
  const rafRef = useRef<number | null>(null);

  const resetForFinish = useCallback(
    (finalStatus: 'done' | 'error') => {
      utteranceRef.current = null;
      setStatus(finalStatus);
      setSpokenRange(null);
      onFinished(finalStatus);
    },
    [setStatus, setSpokenRange, onFinished],
  );

  const startUtterance = useCallback(
    (text: string, offset: number) => {
      const textToSpeak = offset > 0 ? text.slice(offset) : text;
      if (!textToSpeak.trim()) {
        resetForFinish('done');
        return;
      }

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utteranceRef.current = utterance;
      startOffsetRef.current = offset;
      lastBoundaryRef.current = 0;
      startTimeRef.current = null;
      lastBoundaryTimeRef.current = null;

      // Char-timeline for the remaining text, so the RAF loop can estimate
      // word position when onboundary doesn't fire (common in Chrome).
      const speechRate = calibratedRateRef.current * (voiceConfig?.rate ?? 1.0);
      charTimelineRef.current = buildCharTimeline(textToSpeak, speechRate);

      // Applied to every utterance, including resume-from-pause — without
      // this Chrome may silently assign a different voice per utterance.
      if (voiceConfig?.voice) utterance.voice = voiceConfig.voice;
      utterance.rate = voiceConfig?.rate ?? 1.0;
      utterance.volume = voiceConfig?.volume ?? 1.0;

      utterance.onstart = () => {
        startTimeRef.current = performance.now();
        setStatus('playing');
      };

      utterance.onend = () => {
        if (utteranceRef.current !== utterance) return;
        resetForFinish('done');
      };

      utterance.onerror = (e) => {
        if (utteranceRef.current !== utterance) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        utteranceRef.current = null;
        setStatus('error');
        setSpokenRange(null);
        onFinished('error');
      };

      utterance.onboundary = (e) => {
        if (e.name !== 'word') return;
        lastBoundaryRef.current = e.charIndex;
        lastBoundaryTimeRef.current = performance.now();
        const absStart = offset + e.charIndex;
        setSpokenRange({ start: absStart, end: absStart + (e.charLength ?? 1) });
      };

      setStatus('playing');
      window.speechSynthesis.speak(utterance);
    },
    [voiceConfig, setStatus, setSpokenRange, onFinished, resetForFinish],
  );

  const speak = useCallback(
    (text: string) => {
      if (!enabled || !text || !isSpeechSynthesisSupported()) return;
      utteranceRef.current = null;
      window.speechSynthesis.cancel();
      fullTextRef.current = text;
      pausedOffsetRef.current = 0;
      startUtterance(text, 0);
    },
    [enabled, startUtterance],
  );

  const pause = useCallback(() => {
    if (!enabled || status !== 'playing' || !isSpeechSynthesisSupported()) return;
    pausedOffsetRef.current = startOffsetRef.current + lastBoundaryRef.current;
    utteranceRef.current = null;
    window.speechSynthesis.cancel();
    setStatus('paused');
  }, [enabled, status, setStatus]);

  const resume = useCallback(() => {
    if (!enabled || status !== 'paused') return;
    startUtterance(fullTextRef.current, pausedOffsetRef.current);
  }, [enabled, status, startUtterance]);

  const stop = useCallback(() => {
    if (!enabled) return;
    if (isSpeechSynthesisSupported()) {
      utteranceRef.current = null;
      window.speechSynthesis.cancel();
    }
    fullTextRef.current = '';
    startOffsetRef.current = 0;
    lastBoundaryRef.current = 0;
    pausedOffsetRef.current = 0;
    setStatus('idle');
    setSpokenRange(null);
    onFinished('idle');
  }, [enabled, setStatus, setSpokenRange, onFinished]);

  // RAF fallback loop — estimates word position while no onboundary event
  // has fired yet for the current utterance; exits permanently once one does.
  useEffect(() => {
    if (!enabled || status !== 'playing') return undefined;

    const tick = (): void => {
      if (startTimeRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (lastBoundaryTimeRef.current !== null) {
        rafRef.current = null;
        return;
      }

      const elapsed = (performance.now() - startTimeRef.current) / 1000;
      const text = fullTextRef.current;
      const offset = startOffsetRef.current;

      if (elapsed >= 0 && text) {
        const relativePos = estimateBrowserRelativePos(elapsed, charTimelineRef.current, calibratedRateRef.current, text.length - offset);
        const range = wordRangeAround(text, offset + relativePos);
        if (range) setSpokenRange(range);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelScheduledFrame(rafRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, status]);

  // Cleanup on unmount (or `enabled` flipping off mid-playback).
  useEffect(() => {
    return () => {
      if (enabled && isSpeechSynthesisSupported()) {
        utteranceRef.current = null;
        window.speechSynthesis.cancel();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { speak, pause, resume, stop };
}
