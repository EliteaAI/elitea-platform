/**
 * Word-position estimation for the browser `SpeechSynthesis` engine's RAF
 * fallback loop (`useTextToSpeech.hooks.js:801-813`) — split out (pure, no
 * DOM) so `useBrowserTtsEngine.hooks.ts` stays a thin dispatcher and this
 * one piece of arithmetic is independently unit-testable, same rationale as
 * `useModelTtsEngine.raf.ts`.
 */
import { type CharTimeline, findCharAtTime } from '../helpers/ttsTimeline.helpers';

/**
 * Char position RELATIVE to the current utterance's start offset — prefers
 * the punctuation-aware timeline built at utterance-start; falls back to a
 * flat `calibratedRate` estimate (clamped to the remaining text) when no
 * timeline is available.
 */
export function estimateBrowserRelativePos(elapsedSec: number, timeline: CharTimeline | null, calibratedRate: number, remainingLength: number): number {
  if (timeline) return findCharAtTime(timeline.times, elapsedSec);
  return Math.min(Math.floor(elapsedSec * calibratedRate), remainingLength - 1);
}
