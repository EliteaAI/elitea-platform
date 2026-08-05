/**
 * Word-highlight position math shared by both playback engines' RAF loops
 * (`useTextToSpeech.hooks.js:680-825`) — split out (pure, DOM-free) to keep
 * `useModelTtsEngine.hooks.ts`'s own RAF-tick function under the §3.5
 * complexity-12 budget and to make this intricate interpolation logic
 * independently unit-testable.
 */
import { type CharTimeline, findCharAtTime } from './ttsTimeline.helpers';

/** An exact `{charPos, audioTime}` anchor — either the backend's own sentence-boundary waypoint, or a synthesized `(0,0)`/`(text.length, totalDuration)` endpoint. */
export interface TtsWaypoint {
  readonly charPos: number;
  readonly audioTime: number;
}

/**
 * Interpolates the current char position from backend-supplied sentence
 * waypoints (`useTextToSpeech.hooks.js:690-722`): linear interpolation
 * between the two anchors bracketing `elapsed`, or linear extrapolation
 * past the last known anchor using `calibratedRate`.
 */
export function charPosFromWaypoints(
  elapsed: number,
  waypoints: readonly TtsWaypoint[],
  textLength: number,
  allReceived: boolean,
  totalDuration: number,
  calibratedRate: number,
): number {
  const anchors: TtsWaypoint[] = [{ charPos: 0, audioTime: 0 }, ...waypoints];
  if (allReceived && totalDuration > 0) anchors.push({ charPos: textLength, audioTime: totalDuration });

  for (let i = 1; i < anchors.length; i++) {
    const next = anchors[i];
    const prev = anchors[i - 1];
    if (!next || !prev) continue;
    if (elapsed <= next.audioTime) {
      const segDuration = next.audioTime - prev.audioTime;
      const t = segDuration > 0 ? Math.min(1, (elapsed - prev.audioTime) / segDuration) : 0;
      return prev.charPos + Math.floor(t * (next.charPos - prev.charPos));
    }
  }

  // Past all known anchors — extrapolate with the calibrated rate.
  const last = anchors[anchors.length - 1];
  if (!last) return 0;
  return Math.min(textLength - 1, last.charPos + Math.floor((elapsed - last.audioTime) * calibratedRate));
}

/**
 * Falls back to the punctuation-aware char timeline when no backend
 * waypoint has arrived yet (`useTextToSpeech.hooks.js:723-737`), scaling
 * elapsed time against the real measured duration once streaming completes.
 */
export function charPosFromTimeline(
  elapsed: number,
  timeline: CharTimeline | null,
  allReceived: boolean,
  totalDuration: number,
  calibratedRate: number,
  textLength: number,
): number {
  if (!timeline) return Math.min(Math.floor(elapsed * calibratedRate), textLength - 1);
  const scaledElapsed =
    allReceived && totalDuration > 0 && timeline.totalEstimated > 0 ? elapsed * (timeline.totalEstimated / totalDuration) : elapsed;
  return findCharAtTime(timeline.times, scaledElapsed);
}

/**
 * Advances past any whitespace at `pos`, then widens to the full word it
 * lands in. Returns `null` when there is no word there (`end <= start`,
 * e.g. `pos` at end-of-string) — `useTextToSpeech.hooks.js:739-746,816-823`'s
 * shared `if (wordEnd > wordStart) setSpokenRange(...)` guard.
 */
export function wordRangeAround(text: string, pos: number): { readonly start: number; readonly end: number } | null {
  let p = pos;
  while (p < text.length && /\s/.test(text[p] ?? '')) p++;
  let start = p;
  let end = p;
  while (start > 0 && !/\s/.test(text[start - 1] ?? '')) start--;
  while (end < text.length && !/\s/.test(text[end] ?? '')) end++;
  return end > start ? { start, end } : null;
}
