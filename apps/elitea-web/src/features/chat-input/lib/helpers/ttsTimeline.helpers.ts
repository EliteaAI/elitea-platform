/**
 * Ported from `useTextToSpeech.hooks.js:8-57` — punctuation-aware char
 * timeline construction + binary search, used by BOTH playback engines to
 * estimate word position when no exact backend/onboundary anchor is
 * available. Pure, DOM-free — split out for independent unit testing and
 * to keep `useModelTtsEngine.hooks.ts`/`useBrowserTtsEngine.hooks.ts` under
 * the §3.5 400-line budget.
 */

/** Extra pause durations (seconds) inserted after punctuation followed by whitespace or end-of-string, modelling natural speech rhythm. */
export const PUNCTUATION_PAUSES: Readonly<Record<string, number>> = {
  '.': 0.25,
  '!': 0.25,
  '?': 0.25,
  ',': 0.08,
  ';': 0.12,
  ':': 0.12,
  '\n': 0.2,
};

export interface CharTimeline {
  readonly times: Float32Array;
  readonly totalEstimated: number;
}

/** Build a char-index → expected-playback-time (seconds) lookup array. */
export function buildCharTimeline(text: string, charsPerSec: number): CharTimeline {
  const baseInterval = 1 / charsPerSec;
  const times = new Float32Array(text.length + 1);
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    times[i] = t;
    t += baseInterval;
    const ch = text[i];
    const pause = ch !== undefined ? PUNCTUATION_PAUSES[ch] : undefined;
    if (pause !== undefined) {
      const next = text[i + 1];
      if (next === undefined || next === ' ' || next === '\n') {
        t += pause;
      }
    }
  }
  times[text.length] = t;
  return { times, totalEstimated: t };
}

/** Binary search: return the largest char index whose expected time is <= t. */
export function findCharAtTime(times: Float32Array, t: number): number {
  if (t <= 0) return 0;
  const lastTime = times[times.length - 1] ?? 0;
  if (t >= lastTime) return times.length - 2;
  let lo = 0;
  let hi = times.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const midTime = times[mid] ?? 0;
    if (midTime <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
