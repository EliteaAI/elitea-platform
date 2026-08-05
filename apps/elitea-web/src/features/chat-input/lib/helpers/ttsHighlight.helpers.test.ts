import { describe, expect, it } from 'vitest';

import { buildCharTimeline } from './ttsTimeline.helpers';
import { charPosFromTimeline, charPosFromWaypoints, wordRangeAround } from './ttsHighlight.helpers';

describe('charPosFromWaypoints', () => {
  const waypoints = [
    { charPos: 10, audioTime: 1 },
    { charPos: 20, audioTime: 2 },
  ];

  it('interpolates linearly between the synthesized (0,0) anchor and the first waypoint', () => {
    // Halfway (elapsed=0.5) between (0,0) and (10,1) -> charPos 5.
    expect(charPosFromWaypoints(0.5, waypoints, 30, false, 0, 15)).toBe(5);
  });

  it('interpolates linearly between two real waypoints', () => {
    // Halfway (elapsed=1.5) between (10,1) and (20,2) -> charPos 15.
    expect(charPosFromWaypoints(1.5, waypoints, 30, false, 0, 15)).toBe(15);
  });

  it('interpolates into the synthesized end anchor once streaming is fully received', () => {
    // Anchors: (0,0),(10,1),(20,2),(30,3) when allReceived+totalDuration=3.
    expect(charPosFromWaypoints(2.5, waypoints, 30, true, 3, 15)).toBe(25);
  });

  it('extrapolates past the last known anchor using the calibrated rate', () => {
    // Past (20,2) with allReceived=false (no synthesized end anchor):
    // extrapolate 0.5s further at 15 chars/sec -> +7 chars, clamped to textLength-1.
    expect(charPosFromWaypoints(2.5, waypoints, 100, false, 0, 15)).toBe(20 + Math.floor(0.5 * 15));
  });

  it('clamps extrapolation to textLength - 1', () => {
    expect(charPosFromWaypoints(100, waypoints, 25, false, 0, 15)).toBe(24);
  });

  it('with no waypoints at all, interpolates purely between (0,0) and the synthesized end anchor', () => {
    expect(charPosFromWaypoints(1, [], 10, true, 2, 5)).toBe(5);
  });
});

describe('charPosFromTimeline', () => {
  it('falls back to a flat calibratedRate estimate when there is no timeline yet', () => {
    expect(charPosFromTimeline(1, null, false, 0, 10, 100)).toBe(10);
  });

  it('clamps the flat estimate to textLength - 1', () => {
    expect(charPosFromTimeline(100, null, false, 0, 10, 5)).toBe(4);
  });

  it('reads the timeline directly while streaming (not allReceived)', () => {
    const timeline = buildCharTimeline('hello world', 10);
    expect(charPosFromTimeline(0.25, timeline, false, 0, 10, 11)).toBe(2);
  });

  it('scales elapsed against the measured duration once streaming completes', () => {
    const timeline = buildCharTimeline('abcdefghij', 10); // totalEstimated = 1.0
    // Real playback took 2.0s (double the estimate) — elapsed=0.55 scales to
    // timeline-time 0.275, strictly between times[2]=0.2 and times[3]=0.3
    // (kept off an exact float32 boundary on purpose, unlike the un-scaled
    // case above — a boundary-tie here is a floating-point coin flip, not a
    // meaningful assertion).
    const scaled = charPosFromTimeline(0.55, timeline, true, 2.0, 10, 10);
    expect(scaled).toBe(2);
  });
});

describe('wordRangeAround', () => {
  it('returns the word span containing pos', () => {
    expect(wordRangeAround('hello world', 7)).toEqual({ start: 6, end: 11 });
  });

  it('advances past leading whitespace to find the next word', () => {
    expect(wordRangeAround('hello   world', 5)).toEqual({ start: 8, end: 13 });
  });

  it('highlights the trailing word when pos sits exactly at end-of-string with no trailing whitespace', () => {
    // pos=5 is one past 'hello' (length 5) — the forward whitespace-skip is a
    // no-op (pos already >= length), so the backward word-boundary walk
    // still finds and highlights the preceding word.
    expect(wordRangeAround('hello', 5)).toEqual({ start: 0, end: 5 });
  });

  it('returns null when pos sits inside trailing whitespace with no word after it', () => {
    expect(wordRangeAround('hello   ', 5)).toBeNull();
  });

  it('returns the full word when pos is already inside it, not just the char at pos', () => {
    expect(wordRangeAround('elitea platform', 2)).toEqual({ start: 0, end: 6 });
  });
});
