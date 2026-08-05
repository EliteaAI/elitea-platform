/**
 * `tts_audio_chunk`/`tts_done`/`tts_error` handler construction — the
 * socket-listener slice of the model TTS backend
 * (`useTextToSpeech.hooks.js:542-644`). Split out of
 * `useModelTtsEngine.hooks.ts` (plain functions, not hooks) per that file's
 * own module doc — same §3.5 budget rationale as `.scheduler.ts`.
 */
import type { ReceivePayloadOf } from '@/shared/api/socket/events';

import { applyFade, decodePcm16 } from '../helpers/ttsPcm.helpers';

import { enqueueSamples } from './useModelTtsEngine.scheduler';
import type { ModelTtsRefs } from './useModelTtsEngine.types';

/**
 * Flushes the previous pending chunk as-is (consecutive chunks within a
 * sentence are contiguous PCM, no fade needed at that boundary) and applies
 * a fade-in to the head of the NEW chunk if it starts a sentence — then
 * holds the new chunk pending, to be flushed with a fade-out once the
 * sentence-boundary `tts_done` arrives (or as-is if more chunks follow).
 */
export function buildChunkHandler(refs: ModelTtsRefs): (payload: ReceivePayloadOf<'tts_audio_chunk'>) => void {
  return ({ audio, sample_rate }) => {
    const sr = sample_rate ?? 24000;
    const FADE_SAMPLES = Math.floor(sr * 0.005);
    const samples = decodePcm16(audio);

    if (refs.newSentence.current) {
      applyFade(samples, FADE_SAMPLES, 'in');
      refs.newSentence.current = false;
    }

    const pending = refs.pendingChunk.current;
    if (pending) {
      enqueueSamples(refs, pending.samples, pending.sampleRate);
      refs.pendingChunk.current = null;
    }

    refs.pendingChunk.current = { samples, sampleRate: sr };
  };
}

/** Sentence-boundary `tts_done` (carries `char_end`): fade out and flush the pending chunk, record a highlight waypoint. */
function handleSentenceBoundary(refs: ModelTtsRefs, charEnd: number): void {
  const pending = refs.pendingChunk.current;
  if (pending) {
    const sr = pending.sampleRate;
    const FADE_SAMPLES = Math.floor(sr * 0.005);
    applyFade(pending.samples, FADE_SAMPLES, 'out');
    enqueueSamples(refs, pending.samples, sr);
    refs.pendingChunk.current = null;
  }
  refs.newSentence.current = true;

  // Computed from total samples enqueued (not `nextStartTime`), so the
  // waypoint's audioTime is correct regardless of how far the scheduler has
  // actually processed the queue.
  const audioTime = refs.totalEnqueuedSamples.current / refs.sampleRate.current;
  refs.sentenceWaypoints.current.push({ charPos: charEnd, audioTime });
}

/** Final `tts_done` (no `char_end`): flush the last pending chunk verbatim — the master-gain end-of-stream ramp (`.scheduler.ts`'s `finishStreamIfDrained`) handles the click, not an extra fade here. */
function handleFinalDone(refs: ModelTtsRefs): void {
  const pending = refs.pendingChunk.current;
  if (pending) {
    enqueueSamples(refs, pending.samples, pending.sampleRate);
    refs.pendingChunk.current = null;
  }
  refs.finalTtsDone.current = true;
}

export function buildDoneHandler(refs: ModelTtsRefs): (payload: ReceivePayloadOf<'tts_done'>) => void {
  return ({ char_end }) => {
    if (char_end !== undefined) handleSentenceBoundary(refs, char_end);
    else handleFinalDone(refs);
  };
}

export function buildErrorHandler(onError: (error: string | undefined) => void): (payload: ReceivePayloadOf<'tts_error'>) => void {
  return ({ error }) => {
    // eslint-disable-next-line no-console -- deliberate: a server-side TTS error is logged for diagnostics, not thrown (§3.6).
    console.error('[TTS] Server error:', error);
    onError(error);
  };
}
